// ========================================
// TOY (TURN OF YEAR) ENGINE - SEASONAL ANALYSIS
// File: backend/services/toy-barometer.js
// Wayne Whaley's Turn of Year pattern analysis
// ========================================

const MarketDataService = require('./market-data');

class TOYBarometerEngine {
    constructor() {
        this.name = 'TOY (Turn of Year)';
        this.description = 'Wayne Whaley\'s Turn of Year seasonal pattern analysis';
        this.isHealthy = true;
        this.lastError = null;
        this.successCount = 0;
        this.errorCount = 0;
    }

    async analyze(parameters) {
        try {
            const {
                ticker = 'SPY',
                first_year = 2000,
                last_year = new Date().getFullYear(),
                toy_start = '11-19',    // MM-DD format - CUSTOMIZABLE
                toy_end = '01-19',      // MM-DD format - CUSTOMIZABLE
                threshold = 3.0,        // Bullish threshold % - CUSTOMIZABLE
                forward_days = [5, 10, 15, 20, 40, 63, 126, 252]
            } = parameters;

            console.log(`🎄 Running TOY analysis for ${ticker} (${first_year}-${last_year}) from ${toy_start} to ${toy_end}`);

            // Validate custom dates
            const dateErrors = this.validateTOYDates(toy_start, toy_end);
            if (dateErrors.length > 0) {
                throw new Error(`Invalid TOY dates: ${dateErrors.join(', ')}`);
            }

            // Fetch extended historical data
            const data = await MarketDataService.getHistoricalData(ticker, '10y');
            
            if (!data || data.length === 0) {
                throw new Error(`No data available for ${ticker}`);
            }

            // Create date index for faster lookup
            const dataByDate = new Map();
            data.forEach((item, index) => {
                const dateStr = item.date.toISOString().split('T')[0];
                dataByDate.set(dateStr, { ...item, index });
            });

            const events = [];
            const toyPeriods = [];

            // Analyze each year's TOY period
            for (let year = first_year; year <= last_year; year++) {
                try {
                    const toyResult = this.analyzeTOYPeriod(
                        year, toy_start, toy_end, dataByDate, data, threshold, forward_days
                    );
                    
                    if (toyResult) {
                        events.push(toyResult.event);
                        toyPeriods.push(toyResult);
                    }
                } catch (error) {
                    console.warn(`⚠️ Skipping TOY ${year}: ${error.message}`);
                }
            }

            // Calculate summary statistics
            const summary = this.calculateTOYSummary(toyPeriods, threshold, toy_start, toy_end);

            // Update success metrics
            this.successCount++;
            this.isHealthy = true;
            this.lastError = null;

            console.log(`✅ TOY analysis completed: ${events.length} periods analyzed`);

            return {
                success: true,
                data: {
                    matches: events,
                    summary: {
                        total_periods: events.length,
                        analysis_years: `${first_year}-${last_year}`,
                        toy_window: `${toy_start} to ${toy_end}`,
                        threshold: `${threshold}%`,
                        created_by: 'Wayne Whaley TOY methodology',
                        ...summary
                    },
                    toyPeriods, // Additional data for detailed analysis
                    metadata: {
                        strategy: 'toy_barometer',
                        ticker,
                        parameters,
                        customizable_params: {
                            toy_start: 'MM-DD format (e.g., 11-19)',
                            toy_end: 'MM-DD format (e.g., 01-19)', 
                            threshold: 'Bullish threshold percentage (e.g., 3.0)',
                            first_year: 'Start analysis year',
                            last_year: 'End analysis year'
                        }
                    }
                }
            };

        } catch (error) {
            console.error('TOY analysis failed:', error);
            
            // Update error metrics
            this.errorCount++;
            this.lastError = error.message;
            this.isHealthy = false;
            
            return {
                success: false,
                error: `TOY analysis failed: ${error.message}`,
                fallback: 'TOY engine is temporarily unavailable'
            };
        }
    }

    validateTOYDates(toyStart, toyEnd) {
        const errors = [];
        const datePattern = /^\d{1,2}-\d{1,2}$/;
        
        if (!datePattern.test(toyStart)) {
            errors.push('TOY start date must be in MM-DD format (e.g., 11-19)');
        }
        
        if (!datePattern.test(toyEnd)) {
            errors.push('TOY end date must be in MM-DD format (e.g., 01-19)');
        }
        
        if (errors.length === 0) {
            // Validate month/day ranges
            const [startMonth, startDay] = toyStart.split('-').map(x => parseInt(x));
            const [endMonth, endDay] = toyEnd.split('-').map(x => parseInt(x));
            
            if (startMonth < 1 || startMonth > 12) {
                errors.push('Start month must be between 1-12');
            }
            
            if (endMonth < 1 || endMonth > 12) {
                errors.push('End month must be between 1-12');
            }
            
            if (startDay < 1 || startDay > 31) {
                errors.push('Start day must be between 1-31');
            }
            
            if (endDay < 1 || endDay > 31) {
                errors.push('End day must be between 1-31');
            }
        }
        
        return errors;
    }

    analyzeTOYPeriod(year, toyStartMD, toyEndMD, dataByDate, data, threshold, forwardDays) {
        // Parse MM-DD format
        const [startMonth, startDay] = toyStartMD.split('-').map(x => parseInt(x));
        const [endMonth, endDay] = toyEndMD.split('-').map(x => parseInt(x));

        // Handle year crossover (e.g., Nov to Jan)
        const toyStartYear = year;
        const toyEndYear = endMonth < startMonth ? year + 1 : year;

        const toyStart = new Date(toyStartYear, startMonth - 1, startDay);
        const toyEnd = new Date(toyEndYear, endMonth - 1, endDay);

        // Find nearest trading days
        const startTradingDay = this.findNearestTradingDay(toyStart, dataByDate, 'after');
        const endTradingDay = this.findNearestTradingDay(toyEnd, dataByDate, 'after');

        if (!startTradingDay || !endTradingDay) {
            throw new Error(`No trading days found for TOY period ${year}`);
        }

        const startData = dataByDate.get(startTradingDay);
        const endData = dataByDate.get(endTradingDay);

        if (!startData || !endData) {
            throw new Error(`Missing price data for TOY period ${year}`);
        }

        // Calculate TOY return
        const toyReturn = ((endData.close - startData.close) / startData.close) * 100;

        // Determine signal using Wayne Whaley's methodology
        let signal;
        if (toyReturn >= threshold) {
            signal = 'Bullish';
        } else if (toyReturn < 0) {
            signal = 'Bearish'; 
        } else {
            signal = 'Neutral';
        }

        // Calculate forward returns from end of TOY period
        const forwardReturns = this.calculateForwardReturns(
            data, endData.index, forwardDays
        );

        const event = {
            date: endData.date,
            year,
            toy_start_date: startData.date,
            toy_end_date: endData.date,
            toy_return: toyReturn,
            signal,
            start_price: startData.close,
            end_price: endData.close,
            period_days: this.getTradingDaysBetween(startData.date, endData.date),
            toy_window: `${toyStartMD} to ${toyEndMD}`,
            ...forwardReturns
        };

        return {
            event,
            toyReturn,
            signal,
            forwardReturns
        };
    }

    calculateTOYSummary(toyPeriods, threshold, toyStart, toyEnd) {
        if (toyPeriods.length === 0) {
            return { message: 'No TOY periods analyzed' };
        }

        // Group by signal
        const bullishPeriods = toyPeriods.filter(p => p.toyReturn >= threshold);
        const bearishPeriods = toyPeriods.filter(p => p.toyReturn < 0);
        const neutralPeriods = toyPeriods.filter(p => p.toyReturn >= 0 && p.toyReturn < threshold);

        const summary = {
            methodology: `Wayne Whaley TOY analysis (${toyStart} to ${toyEnd})`,
            bullish_periods: bullishPeriods.length,
            bearish_periods: bearishPeriods.length,
            neutral_periods: neutralPeriods.length,
            bullish_rate: `${((bullishPeriods.length / toyPeriods.length) * 100).toFixed(1)}%`,
            bearish_rate: `${((bearishPeriods.length / toyPeriods.length) * 100).toFixed(1)}%`,
            custom_dates: toyStart !== '11-19' || toyEnd !== '01-19' ? 'Yes (non-standard TOY period)' : 'No (standard TOY period)'
        };

        // Calculate average TOY returns by signal
        if (bullishPeriods.length > 0) {
            const avgBullishTOY = bullishPeriods.reduce((sum, p) => sum + p.toyReturn, 0) / bullishPeriods.length;
            summary.avg_bullish_toy_return = `${avgBullishTOY.toFixed(2)}%`;
            
            // Forward performance after bullish signals
            const bullish1M = bullishPeriods.map(p => p.event['1M_return']).filter(r => r !== null);
            if (bullish1M.length > 0) {
                const avg1M = bullish1M.reduce((sum, r) => sum + r, 0) / bullish1M.length;
                const win1M = bullish1M.filter(r => r > 0).length / bullish1M.length * 100;
                summary.bullish_1M_forward = `${avg1M.toFixed(2)}% avg, ${win1M.toFixed(1)}% win rate`;
            }
        }

        if (bearishPeriods.length > 0) {
            const avgBearishTOY = bearishPeriods.reduce((sum, p) => sum + p.toyReturn, 0) / bearishPeriods.length;
            summary.avg_bearish_toy_return = `${avgBearishTOY.toFixed(2)}%`;
            
            // Forward performance after bearish signals
            const bearish1M = bearishPeriods.map(p => p.event['1M_return']).filter(r => r !== null);
            if (bearish1M.length > 0) {
                const avg1M = bearish1M.reduce((sum, r) => sum + r, 0) / bearish1M.length;
                const win1M = bearish1M.filter(r => r > 0).length / bearish1M.length * 100;
                summary.bearish_1M_forward = `${avg1M.toFixed(2)}% avg, ${win1M.toFixed(1)}% win rate`;
            }
        }

        // Add historical insights
        summary.historical_insight = this.generateTOYInsight(toyPeriods, threshold, toyStart, toyEnd);

        return summary;
    }

    generateTOYInsight(toyPeriods, threshold, toyStart, toyEnd) {
        if (toyPeriods.length === 0) return 'Insufficient data for analysis';

        const bullishCount = toyPeriods.filter(p => p.toyReturn >= threshold).length;
        const totalCount = toyPeriods.length;
        const bullishRate = (bullishCount / totalCount) * 100;

        const avgTOYReturn = toyPeriods.reduce((sum, p) => sum + p.toyReturn, 0) / totalCount;

        // Find best and worst TOY years
        const sortedByReturn = [...toyPeriods].sort((a, b) => b.toyReturn - a.toyReturn);
        const bestYear = sortedByReturn[0];
        const worstYear = sortedByReturn[sortedByReturn.length - 1];

        const customPeriod = toyStart !== '11-19' || toyEnd !== '01-19' ? ` (custom period ${toyStart} to ${toyEnd})` : '';

        return `Wayne Whaley's TOY shows ${bullishRate.toFixed(1)}% bullish signals over ${totalCount} years${customPeriod}. ` +
               `Average TOY return: ${avgTOYReturn.toFixed(2)}%. ` +
               `Best: ${bestYear.event.year} (${bestYear.toyReturn.toFixed(2)}%), ` +
               `Worst: ${worstYear.event.year} (${worstYear.toyReturn.toFixed(2)}%)`;
    }

    analyzeTOYPeriod(year, toyStartMD, toyEndMD, dataByDate, data, threshold, forwardDays) {
        // Parse MM-DD format
        const [startMonth, startDay] = toyStartMD.split('-').map(x => parseInt(x));
        const [endMonth, endDay] = toyEndMD.split('-').map(x => parseInt(x));

        // Handle year crossover (Nov to Jan)
        const toyStartYear = year;
        const toyEndYear = endMonth < startMonth ? year + 1 : year;

        const toyStart = new Date(toyStartYear, startMonth - 1, startDay);
        const toyEnd = new Date(toyEndYear, endMonth - 1, endDay);

        // Find nearest trading days
        const startTradingDay = this.findNearestTradingDay(toyStart, dataByDate, 'after');
        const endTradingDay = this.findNearestTradingDay(toyEnd, dataByDate, 'after');

        if (!startTradingDay || !endTradingDay) {
            throw new Error(`No trading days found for TOY period ${year}`);
        }

        const startData = dataByDate.get(startTradingDay);
        const endData = dataByDate.get(endTradingDay);

        if (!startData || !endData) {
            throw new Error(`Missing price data for TOY period ${year}`);
        }

        // Calculate TOY return
        const toyReturn = ((endData.close - startData.close) / startData.close) * 100;

        // Determine signal
        let signal;
        if (toyReturn >= threshold) {
            signal = 'Bullish';
        } else if (toyReturn < 0) {
            signal = 'Bearish'; 
        } else {
            signal = 'Neutral';
        }

        // Calculate forward returns from end of TOY period
        const forwardReturns = this.calculateForwardReturns(
            data, endData.index, forwardDays
        );

        const event = {
            date: endData.date,
            year,
            toy_start_date: startData.date,
            toy_end_date: endData.date,
            toy_return: toyReturn,
            signal,
            start_price: startData.close,
            end_price: endData.close,
            period_days: this.getTradingDaysBetween(startData.date, endData.date),
            ...forwardReturns
        };

        return {
            event,
            toyReturn,
            signal,
            forwardReturns
        };
    }

    findNearestTradingDay(targetDate, dataByDate, direction = 'after') {
        const targetStr = targetDate.toISOString().split('T')[0];
        
        // Try exact match first
        if (dataByDate.has(targetStr)) {
            return targetStr;
        }

        // Search forward or backward
        const searchDate = new Date(targetDate);
        const maxSearchDays = 10; // Limit search to prevent infinite loops
        
        for (let i = 1; i <= maxSearchDays; i++) {
            if (direction === 'after') {
                searchDate.setDate(targetDate.getDate() + i);
            } else {
                searchDate.setDate(targetDate.getDate() - i);
            }
            
            const searchStr = searchDate.toISOString().split('T')[0];
            if (dataByDate.has(searchStr)) {
                return searchStr;
            }
        }

        return null;
    }

    calculateForwardReturns(data, startIndex, forwardDays) {
        const returns = {};
        const startPrice = data[startIndex].close;

        forwardDays.forEach(days => {
            const futureIndex = startIndex + days;
            
            if (futureIndex < data.length) {
                const futurePrice = data[futureIndex].close;
                const returnPct = ((futurePrice - startPrice) / startPrice) * 100;
                
                // Map days to readable labels
                const label = this.mapDaysToLabel(days);
                returns[`${label}_return`] = returnPct;
            } else {
                const label = this.mapDaysToLabel(days);
                returns[`${label}_return`] = null;
            }
        });

        return returns;
    }

    mapDaysToLabel(days) {
        const labelMap = {
            1: '1D', 2: '2D', 3: '3D', 4: '4D', 5: '1W',
            10: '2W', 15: '3W', 20: '1M', 21: '1M', 40: '2M', 
            42: '2M', 60: '3M', 63: '3M', 126: '6M', 252: '12M'
        };
        
        return labelMap[days] || `${days}D`;
    }

    calculateTOYSummary(toyPeriods, threshold) {
        if (toyPeriods.length === 0) {
            return { message: 'No TOY periods analyzed' };
        }

        // Group by signal
        const bullishPeriods = toyPeriods.filter(p => p.toyReturn >= threshold);
        const bearishPeriods = toyPeriods.filter(p => p.toyReturn < 0);
        const neutralPeriods = toyPeriods.filter(p => p.toyReturn >= 0 && p.toyReturn < threshold);

        const summary = {
            bullish_periods: bullishPeriods.length,
            bearish_periods: bearishPeriods.length,
            neutral_periods: neutralPeriods.length,
            bullish_rate: `${((bullishPeriods.length / toyPeriods.length) * 100).toFixed(1)}%`,
            bearish_rate: `${((bearishPeriods.length / toyPeriods.length) * 100).toFixed(1)}%`
        };

        // Calculate average TOY returns by signal
        if (bullishPeriods.length > 0) {
            const avgBullishTOY = bullishPeriods.reduce((sum, p) => sum + p.toyReturn, 0) / bullishPeriods.length;
            summary.avg_bullish_toy_return = `${avgBullishTOY.toFixed(2)}%`;
        }

        if (bearishPeriods.length > 0) {
            const avgBearishTOY = bearishPeriods.reduce((sum, p) => sum + p.toyReturn, 0) / bearishPeriods.length;
            summary.avg_bearish_toy_return = `${avgBearishTOY.toFixed(2)}%`;
        }

        // Calculate forward return statistics for each signal
        const forwardPeriods = ['1M_return', '3M_return', '6M_return', '12M_return'];
        
        ['bullish', 'bearish', 'neutral'].forEach(signalType => {
            let periods;
            switch (signalType) {
                case 'bullish': periods = bullishPeriods; break;
                case 'bearish': periods = bearishPeriods; break;
                case 'neutral': periods = neutralPeriods; break;
            }

            if (periods.length > 0) {
                forwardPeriods.forEach(period => {
                    const returns = periods
                        .map(p => p.event[period])
                        .filter(r => r !== null && r !== undefined);
                    
                    if (returns.length > 0) {
                        const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
                        const winRate = (returns.filter(r => r > 0).length / returns.length) * 100;
                        
                        summary[`${signalType}_${period.replace('_return', '')}_avg`] = `${avgReturn.toFixed(2)}%`;
                        summary[`${signalType}_${period.replace('_return', '')}_win_rate`] = `${winRate.toFixed(1)}%`;
                    }
                });
            }
        });

        // Add historical insights
        summary.historical_insight = this.generateTOYInsight(toyPeriods, threshold);

        return summary;
    }

    generateTOYInsight(toyPeriods, threshold) {
        if (toyPeriods.length === 0) return 'Insufficient data for analysis';

        const bullishCount = toyPeriods.filter(p => p.toyReturn >= threshold).length;
        const totalCount = toyPeriods.length;
        const bullishRate = (bullishCount / totalCount) * 100;

        const avgTOYReturn = toyPeriods.reduce((sum, p) => sum + p.toyReturn, 0) / totalCount;

        // Find best and worst TOY years
        const sortedByReturn = [...toyPeriods].sort((a, b) => b.toyReturn - a.toyReturn);
        const bestYear = sortedByReturn[0];
        const worstYear = sortedByReturn[sortedByReturn.length - 1];

        return `TOY Barometer shows ${bullishRate.toFixed(1)}% bullish signals over ${totalCount} years. ` +
               `Average TOY return: ${avgTOYReturn.toFixed(2)}%. ` +
               `Best: ${bestYear.event.year} (${bestYear.toyReturn.toFixed(2)}%), ` +
               `Worst: ${worstYear.event.year} (${worstYear.toyReturn.toFixed(2)}%)`;
    }

    getTradingDaysBetween(startDate, endDate) {
        let tradingDays = 0;
        const currentDate = new Date(startDate);
        
        while (currentDate <= endDate) {
            const dayOfWeek = currentDate.getDay();
            // Skip weekends
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                tradingDays++;
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        return tradingDays;
    }

    // Method to get the most recent TOY signal
    getCurrentTOYSignal(toyPeriods) {
        if (toyPeriods.length === 0) return null;
        
        const mostRecent = toyPeriods[toyPeriods.length - 1];
        return {
            year: mostRecent.event.year,
            signal: mostRecent.signal,
            toy_return: mostRecent.toyReturn,
            strength: Math.abs(mostRecent.toyReturn)
        };
    }

    // Method for validating TOY parameters
    validateParameters(parameters) {
        const errors = [];
        
        if (parameters.threshold && (parameters.threshold < 0 || parameters.threshold > 20)) {
            errors.push('Threshold should be between 0% and 20%');
        }
        
        if (parameters.first_year && parameters.last_year && 
            parameters.first_year >= parameters.last_year) {
            errors.push('First year must be before last year');
        }
        
        // Validate date format
        const datePattern = /^\d{1,2}-\d{1,2}$/;
        if (parameters.toy_start && !datePattern.test(parameters.toy_start)) {
            errors.push('TOY start date must be in MM-DD format');
        }
        
        if (parameters.toy_end && !datePattern.test(parameters.toy_end)) {
            errors.push('TOY end date must be in MM-DD format');
        }
        
        return errors;
    }

    // Health status for engine coordinator
    getHealthStatus() {
        return {
            name: this.name,
            healthy: this.isHealthy,
            successRate: this.successCount / (this.successCount + this.errorCount) || 0,
            lastError: this.lastError,
            totalAnalyses: this.successCount + this.errorCount
        };
    }

    getFallbackMessage() {
        return 'TOY Barometer engine is temporarily unavailable. Please try again later.';
    }
}

module.exports = TOYBarometerEngine;