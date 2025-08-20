// ========================================
// MARKET DATA SERVICE
// File: backend/services/market-data.js
// ========================================

const yahooFinance = require('yahoo-finance2').default;

class MarketDataService {
    static async getHistoricalData(ticker, period = '5y') {
        try {
            const quote = await yahooFinance.historical(ticker, {
                period1: this.getPeriodStart(period),
                period2: new Date(),
                interval: '1d'
            });
            
            return quote.map(item => ({
                date: item.date,
                open: item.open,
                high: item.high,
                low: item.low,
                close: item.close,
                volume: item.volume
            }));
        } catch (error) {
            console.error(`Failed to fetch data for ${ticker}:`, error.message);
            throw new Error(`Failed to fetch market data for ${ticker}`);
        }
    }
    
    static getPeriodStart(period) {
        const now = new Date();
        const periods = {
            '1y': new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()),
            '2y': new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()),
            '5y': new Date(now.getFullYear() - 5, now.getMonth(), now.getDate()),
            '10y': new Date(now.getFullYear() - 10, now.getMonth(), now.getDate())
        };
        return periods[period] || periods['5y'];
    }
    
    static async getCurrentPrice(ticker) {
        try {
            const quote = await yahooFinance.quote(ticker);
            return {
                price: quote.regularMarketPrice,
                change: quote.regularMarketChange,
                changePercent: quote.regularMarketChangePercent,
                volume: quote.regularMarketVolume
            };
        } catch (error) {
            console.error(`Failed to fetch current price for ${ticker}:`, error.message);
            return null;
        }
    }
}

module.exports = MarketDataService;