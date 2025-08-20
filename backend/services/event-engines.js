// ========================================
// EVENT ENGINES - FAULT TOLERANT
// File: backend/services/event-engines.js
// ========================================

const MarketDataService = require('./market-data');
const TOYBarometerEngine = require('./toy-barometer');

// Base Event Engine Class
class BaseEventEngine {
    constructor(name) {
        this.name = name;
        this.isHealthy = true;
        this.lastError = null;
        this.successCount = 0;
        this.errorCount = 0;
    }

    async safeExecute(analysisFunction, ...args) {
        try {
            const result = await analysisFunction.apply(this, args);
            this.successCount++;
            this.isHealthy = true;
            this.lastError = null;
            return { success: true, data: result };
        } catch (error) {
            this.errorCount++;
            this.lastError = error.message;
            this.isHealthy = false;
            
            console.error(`❌ ${this.name} Engine Failed:`, error.message);
            
            return { 
                success: false, 
                error: `${this.name} analysis unavailable: ${error.message}`,
                fallback: this.getFallbackMessage()
            };
        }
    }

    getFallbackMessage() {
        return `${this.name} engine is temporarily unavailable. Please try again later.`;
    }

    getHealthStatus() {
        return {
            name: this.name,
            healthy: this.isHealthy,
            successRate: this.successCount / (this.successCount + this.errorCount) || 0,
            lastError: this.lastError,
            totalAnalyses: this.successCount + this.errorCount
        };
    }
}

// ========================================
// ENGINE 1: PERCENT MOVE EVENTS
// ========================================

class PercentMoveEngine extends BaseEventEngine {
    constructor() {
        super('Percent Move');
    }

    async analyze(data, parameters) {
        return this.safeExecute(this._analyzePercentMove, data, parameters);
    }

    _analyzePercentMove(data, { percent_move = 5, days = 5, direction = 'both' }) {
        const matches = [];
        
        for (let i = 0; i < data.length - days; i++) {
            const startPrice = data[i].close;
            const endPrice = data[i + days].close;
            const cumulativeReturn = ((endPrice / startPrice) - 1) * 100;
            
            let isMatch = false;
            
            if (direction === 'up' && cumulativeReturn >= percent_move) {
                isMatch = true;
            } else if (direction === 'down' && cumulativeReturn <= -Math.abs(percent_move)) {
                isMatch = true;
            } else if (direction === 'both' && Math.abs(cumulativeReturn) >= Math.abs(percent_move)) {
                isMatch = true;
            }
            
            if (isMatch) {
                matches.push({
                    date: data[i + days].date,
                    startPrice,
                    endPrice,
                    return: cumulativeReturn,
                    direction: cumulativeReturn > 0 ? 'up' : 'down'
                });
            }
        }
        
        return {
            matches,
            summary: {
                total_matches: matches.length,
                avg_return: matches.length > 0 ? 
                    matches.reduce((sum, m) => sum + m.return, 0) / matches.length : 0,
                criteria: `${Math.abs(percent_move)}% moves over ${days} days`
            }
        };
    }
}

// ========================================
// ENGINE 2: REVERSAL EVENTS  
// ========================================

class ReversalEngine extends BaseEventEngine {
    constructor() {
        super('Reversal Patterns');
    }

    async analyze(data, parameters) {
        return this.safeExecute(this._analyzeReversal, data, parameters);
    }

    _analyzeReversal(data, { open_threshold = 2, close_threshold = 1, pattern = 'bearish' }) {
        const matches = [];
        
        for (let i = 1; i < data.length; i++) {
            const prevClose = data[i - 1].close;
            const open = data[i].open;
            const close = data[i].close;
            
            const openMove = ((open - prevClose) / prevClose) * 100;
            const closeMove = ((close - open) / open) * 100;
            
            let isMatch = false;
            
            if (pattern === 'bearish' && openMove >= open_threshold && closeMove <= -close_threshold) {
                // Opens up but closes down
                isMatch = true;
            } else if (pattern === 'bullish' && openMove <= -open_threshold && closeMove >= close_threshold) {
                // Opens down but closes up
                isMatch = true;
            }
            
            if (isMatch) {
                matches.push({
                    date: data[i].date,
                    prevClose,
                    open,
                    close,
                    openMove,
                    closeMove,
                    pattern,
                    reversal_size: Math.abs(openMove + closeMove)
                });
            }
        }
        
        return {
            matches,
            summary: {
                total_matches: matches.length,
                pattern_type: pattern,
                avg_reversal: matches.length > 0 ? 
                    matches.reduce((sum, m) => sum + m.reversal_size, 0) / matches.length : 0,
                criteria: `${pattern} reversals: open ${open_threshold}%, close ${close_threshold}%`
            }
        };
    }
}

// ========================================
// ENGINE 3: SECTOR SPREAD EVENTS
// ========================================

class SectorSpreadEngine extends BaseEventEngine {
    constructor() {
        super('Sector Spread');
    }

    async analyze(data, parameters) {
        return this.safeExecute(this._analyzeSectorSpread, data, parameters);
    }

    async _analyzeSectorSpread({ sector_a = 'XLK', sector_b = 'XLF', spread_threshold = 5, days = 10 }) {
        // Fetch data for both sectors
        const [dataA, dataB] = await Promise.all([
            MarketDataService.getHistoricalData(sector_a),
            MarketDataService.getHistoricalData(sector_b)
        ]);
        
        // Align dates
        const alignedData = this._alignDataSeries(dataA, dataB);
        const matches = [];
        
        for (let i = 0; i < alignedData.length - days; i++) {
            const startA = alignedData[i].a.close;
            const endA = alignedData[i + days].a.close;
            const startB = alignedData[i].b.close;
            const endB = alignedData[i + days].b.close;
            
            const retA = ((endA / startA) - 1) * 100;
            const retB = ((endB / startB) - 1) * 100;
            const spread = retA - retB;
            
            if (Math.abs(spread) >= Math.abs(spread_threshold)) {
                matches.push({
                    date: alignedData[i + days].date,
                    sector_a: { symbol: sector_a, start: startA, end: endA, return: retA },
                    sector_b: { symbol: sector_b, start: startB, end: endB, return: retB },
                    spread,
                    outperformer: spread > 0 ? sector_a : sector_b
                });
            }
        }
        
        return {
            matches,
            summary: {
                total_matches: matches.length,
                avg_spread: matches.length > 0 ? 
                    matches.reduce((sum, m) => sum + Math.abs(m.spread), 0) / matches.length : 0,
                criteria: `${sector_a} vs ${sector_b} spread >${Math.abs(spread_threshold)}% over ${days} days`
            }
        };
    }

    _alignDataSeries(dataA, dataB) {
        const aligned = [];
        const dateMapA = new Map(dataA.map(item => [item.date.toISOString().split('T')[0], item]));
        const dateMapB = new Map(dataB.map(item => [item.date.toISOString().split('T')[0], item]));
        
        for (const [dateStr, itemA] of dateMapA) {
            const itemB = dateMapB.get(dateStr);
            if (itemB) {
                aligned.push({ date: itemA.date, a: itemA, b: itemB });
            }
        }
        
        return aligned.sort((a, b) => a.date - b.date);
    }
}

// ========================================
// ENGINE 4: MOMENTUM EVENTS
// ========================================

class MomentumEngine extends BaseEventEngine {
    constructor() {
        super('Momentum Patterns');
    }

    async analyze(data, parameters) {
        return this.safeExecute(this._analyzeMomentum, data, parameters);
    }

    _analyzeMomentum(data, { sma_period = 20, days = 60, momentum_type = 'bullish', threshold = 1.2 }) {
        const dataWithSMA = this._calculateSMA(data, sma_period);
        const matches = [];
        let lastMatchDate = null;
        const minGapDays = 30;
        
        for (let i = sma_period; i < dataWithSMA.length - days; i++) {
            // Skip if too close to last match
            const currentDate = new Date(dataWithSMA[i + days].date);
            if (lastMatchDate && (currentDate - lastMatchDate) / (1000 * 60 * 60 * 24) < minGapDays) {
                continue;
            }
            
            let isValidPeriod = true;
            let extremeValue = 0;
            let startPrice = dataWithSMA[i].close;
            
            if (momentum_type === 'bullish') {
                // Check if price stayed above SMA
                let highestPrice = startPrice;
                
                for (let j = i; j < i + days; j++) {
                    if (dataWithSMA[j].close <= dataWithSMA[j].sma) {
                        isValidPeriod = false;
                        break;
                    }
                    
                    if (dataWithSMA[j].close > highestPrice) {
                        highestPrice = dataWithSMA[j].close;
                    }
                    
                    const drawdown = ((dataWithSMA[j].close - highestPrice) / highestPrice) * 100;
                    if (drawdown < extremeValue) {
                        extremeValue = drawdown;
                    }
                }
                
                // Check if max drawdown is within threshold
                if (isValidPeriod && extremeValue >= -Math.abs(threshold)) {
                    matches.push({
                        date: dataWithSMA[i + days].date,
                        startPrice,
                        endPrice: dataWithSMA[i + days].close,
                        maxDrawdown: extremeValue,
                        periodReturn: ((dataWithSMA[i + days].close / startPrice) - 1) * 100,
                        daysAboveSMA: days
                    });
                    lastMatchDate = currentDate;
                }
            } else if (momentum_type === 'bearish') {
                // Check if price stayed below SMA
                let lowestPrice = startPrice;
                
                for (let j = i; j < i + days; j++) {
                    if (dataWithSMA[j].close >= dataWithSMA[j].sma) {
                        isValidPeriod = false;
                        break;
                    }
                    
                    if (dataWithSMA[j].close < lowestPrice) {
                        lowestPrice = dataWithSMA[j].close;
                    }
                    
                    const rally = ((dataWithSMA[j].close - lowestPrice) / lowestPrice) * 100;
                    if (rally > extremeValue) {
                        extremeValue = rally;
                    }
                }
                
                // Check if max rally is within threshold
                if (isValidPeriod && extremeValue <= Math.abs(threshold)) {
                    matches.push({
                        date: dataWithSMA[i + days].date,
                        startPrice,
                        endPrice: dataWithSMA[i + days].close,
                        maxRally: extremeValue,
                        periodReturn: ((dataWithSMA[i + days].close / startPrice) - 1) * 100,
                        daysBelowSMA: days
                    });
                    lastMatchDate = currentDate;
                }
            }
        }
        
        return {
            matches,
            summary: {
                total_matches: matches.length,
                momentum_type,
                avg_return: matches.length > 0 ? 
                    matches.reduce((sum, m) => sum + m.periodReturn, 0) / matches.length : 0,
                criteria: `${momentum_type} momentum: ${days} days ${momentum_type === 'bullish' ? 'above' : 'below'} ${sma_period}-SMA`
            }
        };
    }

    _calculateSMA(data, period) {
        const result = [...data];
        
        for (let i = period - 1; i < result.length; i++) {
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) {
                sum += result[j].close;
            }
            result[i].sma = sum / period;
        }
        
        return result;
    }
}

// ========================================
// ENGINE 5: VOLATILITY EVENTS (VIX-based)
// ========================================

class VolatilityEngine extends BaseEventEngine {
    constructor() {
        super('Volatility Events');
    }

    async analyze(data, parameters) {
        return this.safeExecute(this._analyzeVolatility, data, parameters);
    }

    async _analyzeVolatility({ ticker = 'SPY', vix_threshold = 25, price_condition = 'any', price_threshold = 2 }) {
        // Get VIX data
        const vixData = await MarketDataService.getHistoricalData('^VIX');
        const priceData = data;
        
        // Align VIX and price data
        const alignedData = this._alignDataSeries(priceData, vixData);
        const matches = [];
        
        for (let i = 1; i < alignedData.length; i++) {
            const vixLevel = alignedData[i].b.close; // VIX close
            const priceChange = ((alignedData[i].a.close - alignedData[i-1].a.close) / alignedData[i-1].a.close) * 100;
            
            let priceConditionMet = true;
            
            if (price_condition === 'down' && priceChange >= -Math.abs(price_threshold)) {
                priceConditionMet = false;
            } else if (price_condition === 'up' && priceChange <= Math.abs(price_threshold)) {
                priceConditionMet = false;
            } else if (price_condition === 'gap_down' && priceChange >= -Math.abs(price_threshold)) {
                // For gap downs, we'd need open vs prev close
                const gapDown = ((alignedData[i].a.open - alignedData[i-1].a.close) / alignedData[i-1].a.close) * 100;
                priceConditionMet = gapDown <= -Math.abs(price_threshold);
            }
            
            if (vixLevel >= vix_threshold && priceConditionMet) {
                matches.push({
                    date: alignedData[i].a.date,
                    vix_level: vixLevel,
                    price_change: priceChange,
                    price: alignedData[i].a.close,
                    condition_met: `VIX ${vixLevel.toFixed(1)} + ${ticker} ${priceChange.toFixed(2)}%`
                });
            }
        }
        
        return {
            matches,
            summary: {
                total_matches: matches.length,
                avg_vix: matches.length > 0 ? 
                    matches.reduce((sum, m) => sum + m.vix_level, 0) / matches.length : 0,
                criteria: `VIX >${vix_threshold} with ${ticker} ${price_condition} moves`
            }
        };
    }

    _alignDataSeries(dataA, dataB) {
        const aligned = [];
        const dateMapA = new Map(dataA.map(item => [item.date.toISOString().split('T')[0], item]));
        const dateMapB = new Map(dataB.map(item => [item.date.toISOString().split('T')[0], item]));
        
        for (const [dateStr, itemA] of dateMapA) {
            const itemB = dateMapB.get(dateStr);
            if (itemB) {
                aligned.push({ date: itemA.date, a: itemA, b: itemB });
            }
        }
        
        return aligned.sort((a, b) => a.date - b.date);
    }
}

// ========================================
// ENGINE 6: MACRO EVENTS
// ========================================

class MacroEngine extends BaseEventEngine {
    constructor() {
        super('Macro Events');
    }

    async analyze(data, parameters) {
        return this.safeExecute(this._analyzeMacro, data, parameters);
    }

    _analyzeMacro({ cpi_threshold, dxy_threshold, rate_threshold }) {
        // Simulated macro data - replace with FRED API
        const currentMacro = {
            CPI: 3.2,
            DXY_YTD: 2.8,
            Interest_Rate: 5.25,
            last_updated: new Date().toISOString()
        };
        
        const conditions = [];
        let conditionsMet = 0;
        let totalConditions = 0;
        
        if (cpi_threshold !== undefined) {
            totalConditions++;
            const met = currentMacro.CPI >= cpi_threshold;
            conditions.push({
                metric: 'CPI',
                threshold: cpi_threshold,
                current: currentMacro.CPI,
                met
            });
            if (met) conditionsMet++;
        }
        
        if (dxy_threshold !== undefined) {
            totalConditions++;
            const met = currentMacro.DXY_YTD >= dxy_threshold;
            conditions.push({
                metric: 'DXY YTD',
                threshold: dxy_threshold,
                current: currentMacro.DXY_YTD,
                met
            });
            if (met) conditionsMet++;
        }
        
        if (rate_threshold !== undefined) {
            totalConditions++;
            const met = currentMacro.Interest_Rate >= rate_threshold;
            conditions.push({
                metric: 'Fed Funds Rate',
                threshold: rate_threshold,
                current: currentMacro.Interest_Rate,
                met
            });
            if (met) conditionsMet++;
        }
        
        const allConditionsMet = conditionsMet === totalConditions && totalConditions > 0;
        
        return {
            matches: allConditionsMet ? [{ date: new Date(), signal: 'Macro conditions met' }] : [],
            summary: {
                conditions_met: `${conditionsMet}/${totalConditions}`,
                signal: allConditionsMet ? '✅ All macro conditions met' : '❌ Macro conditions not met',
                conditions,
                current_macro: currentMacro
            }
        };
    }
}

// ========================================
// MASTER ENGINE COORDINATOR
// ========================================

class EventEngineCoordinator {
    constructor() {
        this.engines = new Map([
            ['PERCENT_MOVE', new PercentMoveEngine()],
            ['REVERSAL', new ReversalEngine()],
            ['SECTOR_SPREAD', new SectorSpreadEngine()],
            ['MOMENTUM_BULLISH', new MomentumEngine()],
            ['MOMENTUM_BEARISH', new MomentumEngine()],
            ['VOLATILITY_EVENT', new VolatilityEngine()],
            ['MACRO_EVENT', new MacroEngine()],
            ['TOY_BAROMETER', new TOYBarometerEngine()]  // Your seasonal analysis
        ]);
    }

    async runEventAnalysis(eventType, ticker, parameters) {
        const engine = this.engines.get(eventType);
        
        if (!engine) {
            throw new Error(`Unknown event type: ${eventType}`);
        }
        
        console.log(`🔍 Running ${eventType} analysis for ${ticker}`);
        
        // Special handling for TOY Barometer (doesn't need market data the same way)
        if (eventType === 'TOY_BAROMETER') {
            const result = await engine.analyze({ ticker, ...parameters });
            if (!result.success) {
                throw new Error(result.error);
            }
            return result.data;
        }
        
        // Get market data (except for macro events)
        let data = null;
        if (eventType !== 'MACRO_EVENT') {
            data = await MarketDataService.getHistoricalData(ticker);
            if (!data || data.length === 0) {
                throw new Error(`No market data available for ${ticker}`);
            }
        }
        
        // Add momentum type parameter for momentum engines
        if (eventType === 'MOMENTUM_BULLISH') {
            parameters.momentum_type = 'bullish';
        } else if (eventType === 'MOMENTUM_BEARISH') {
            parameters.momentum_type = 'bearish';
        }
        
        // Run the analysis
        const result = await engine.analyze(data, parameters);
        
        if (!result.success) {
            throw new Error(result.error);
        }
        
        return result.data;
    }

    getEngineHealthStatus() {
        const status = {};
        for (const [type, engine] of this.engines) {
            status[type] = engine.getHealthStatus();
        }
        return status;
    }

    getAvailableEngines() {
        const available = [];
        for (const [type, engine] of this.engines) {
            if (engine.isHealthy) {
                available.push(type);
            }
        }
        return available;
    }
}

module.exports = {
    EventEngineCoordinator,
    PercentMoveEngine,
    ReversalEngine,
    SectorSpreadEngine,
    MomentumEngine,
    VolatilityEngine,
    MacroEngine
};