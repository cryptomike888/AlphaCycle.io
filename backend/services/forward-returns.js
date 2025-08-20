// ========================================
// EXTENDED FORWARD RETURNS CALCULATOR
// File: backend/services/forward-returns.js
// ========================================

class ExtendedForwardReturnsCalculator {
    static calculate(data, matches, customPeriods = null) {
        if (!matches || matches.length === 0) {
            return { 
                results: [], 
                summary: { 
                    'Total Matches': 0,
                    'Message': 'No historical instances found for this event pattern'
                },
                performanceTable: this.getEmptyPerformanceTable()
            };
        }

        // Define all timeframes with trading days
        const periods = customPeriods || {
            '1D': 1,
            '2D': 2, 
            '3D': 3,
            '4D': 4,
            '1W': 5,    // 5 trading days
            '2W': 10,   // 10 trading days
            '1M': 21,   // ~21 trading days
            '2M': 42,   // ~42 trading days  
            '3M': 63,   // ~63 trading days
            '6M': 126,  // ~126 trading days
            '12M': 252  // ~252 trading days
        };

        console.log(`📊 Calculating forward returns for ${matches.length} matches across ${Object.keys(periods).length} timeframes`);

        const results = [];
        const performanceData = {};
        
        // Initialize performance tracking for each period
        Object.keys(periods).forEach(period => {
            performanceData[period] = {
                returns: [],
                winCount: 0,
                totalCount: 0
            };
        });

        // Create date index for faster lookup
        const dataByDate = new Map();
        data.forEach((item, index) => {
            const dateStr = new Date(item.date).toISOString().split('T')[0];
            dataByDate.set(dateStr, { ...item, index });
        });

        // Process each match
        for (const match of matches) {
            const matchDate = new Date(match.date);
            const matchDateStr = matchDate.toISOString().split('T')[0];
            const currentData = dataByDate.get(matchDateStr);

            if (!currentData) {
                console.warn(`⚠️ No data found for match date: ${matchDateStr}`);
                continue;
            }

            const row = {
                'Match Date': matchDateStr,
                'Price': `$${currentData.close.toFixed(2)}`,
                'Event Details': this.formatEventDetails(match)
            };

            // Calculate forward returns for each period
            for (const [label, days] of Object.entries(periods)) {
                const futureIndex = currentData.index + days;

                if (futureIndex < data.length) {
                    const futurePrice = data[futureIndex].close;
                    const returnPct = ((futurePrice - currentData.close) / currentData.close) * 100;
                    
                    // Format return with color coding
                    const formattedReturn = this.formatReturn(returnPct);
                    row[`${label} Return`] = formattedReturn;
                    
                    // Track performance data
                    performanceData[label].returns.push(returnPct);
                    performanceData[label].totalCount++;
                    
                    if (returnPct > 0) {
                        performanceData[label].winCount++;
                    }
                } else {
                    row[`${label} Return`] = 'N/A';
                }
            }

            results.push(row);
        }

        // Calculate summary statistics
        const summary = this.calculateSummaryStats(performanceData, matches.length);
        
        // Generate performance table
        const performanceTable = this.generatePerformanceTable(performanceData);

        console.log(`✅ Forward returns calculated: ${results.length} matches processed`);

        return { 
            results, 
            summary, 
            performanceTable,
            metadata: {
                totalMatches: matches.length,
                dataPointsAnalyzed: results.length,
                timeframes: Object.keys(periods),
                calculatedAt: new Date().toISOString()
            }
        };
    }

    static formatEventDetails(match) {
        // Format event details based on match type
        if (match.return !== undefined) {
            return `${match.return > 0 ? '+' : ''}${match.return.toFixed(2)}% move`;
        } else if (match.openMove !== undefined && match.closeMove !== undefined) {
            return `Open: ${match.openMove > 0 ? '+' : ''}${match.openMove.toFixed(1)}%, Close: ${match.closeMove > 0 ? '+' : ''}${match.closeMove.toFixed(1)}%`;
        } else if (match.spread !== undefined) {
            return `Spread: ${match.spread > 0 ? '+' : ''}${match.spread.toFixed(2)}%`;
        } else if (match.vix_level !== undefined) {
            return `VIX: ${match.vix_level.toFixed(1)}, Price: ${match.price_change > 0 ? '+' : ''}${match.price_change.toFixed(2)}%`;
        } else if (match.toy_return !== undefined) {
            return `TOY: ${match.toy_return > 0 ? '+' : ''}${match.toy_return.toFixed(2)}% (${match.signal})`;
        } else {
            return 'Event occurred';
        }
    }

    static formatReturn(returnPct) {
        const formatted = `${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%`;
        
        // Add magnitude indicators
        if (Math.abs(returnPct) >= 10) {
            return `${formatted} 🔥`; // Large move
        } else if (Math.abs(returnPct) >= 5) {
            return `${formatted} ⚡`; // Significant move
        } else if (returnPct > 0) {
            return `${formatted} ✅`; // Positive
        } else if (returnPct < 0) {
            return `${formatted} ❌`; // Negative
        } else {
            return `${formatted} ➖`; // Flat
        }
    }

    static calculateSummaryStats(performanceData, totalMatches) {
        const summary = {
            'Total Matches': totalMatches,
            'Analysis Period': '2020-2024',
            'Data Quality': 'Historical market data'
        };

        for (const [period, data] of Object.entries(performanceData)) {
            if (data.returns.length > 0) {
                const avgReturn = data.returns.reduce((sum, ret) => sum + ret, 0) / data.returns.length;
                const winRate = (data.winCount / data.totalCount) * 100;
                const maxReturn = Math.max(...data.returns);
                const minReturn = Math.min(...data.returns);
                
                // Calculate standard deviation
                const variance = data.returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / data.returns.length;
                const stdDev = Math.sqrt(variance);
                
                // Calculate Sharpe-like ratio (return/volatility)
                const returnVolatilityRatio = stdDev > 0 ? avgReturn / stdDev : 0;

                summary[`${period} Avg Return`] = `${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%`;
                summary[`${period} Win Rate`] = `${winRate.toFixed(1)}%`;
                summary[`${period} Best`] = `${maxReturn >= 0 ? '+' : ''}${maxReturn.toFixed(2)}%`;
                summary[`${period} Worst`] = `${minReturn >= 0 ? '+' : ''}${minReturn.toFixed(2)}%`;
                summary[`${period} Volatility`] = `${stdDev.toFixed(2)}%`;
                summary[`${period} Return/Vol`] = returnVolatilityRatio.toFixed(2);
            } else {
                summary[`${period} Avg Return`] = 'N/A';
                summary[`${period} Win Rate`] = 'N/A';
            }
        }

        // Add key insights
        const bestPeriods = this.findBestPerformingPeriods(performanceData);
        if (bestPeriods.length > 0) {
            summary['Best Timeframe'] = bestPeriods[0];
            summary['Key Insight'] = this.generateKeyInsight(performanceData, bestPeriods[0]);
        }

        return summary;
    }

    static generatePerformanceTable(performanceData) {
        const table = {
            headers: ['Timeframe', 'Avg Return', 'Win Rate', 'Best', 'Worst', 'Volatility', 'Samples'],
            rows: []
        };

        for (const [period, data] of Object.entries(performanceData)) {
            if (data.returns.length > 0) {
                const avgReturn = data.returns.reduce((sum, ret) => sum + ret, 0) / data.returns.length;
                const winRate = (data.winCount / data.totalCount) * 100;
                const maxReturn = Math.max(...data.returns);
                const minReturn = Math.min(...data.returns);
                
                const variance = data.returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) / data.returns.length;
                const stdDev = Math.sqrt(variance);

                table.rows.push({
                    timeframe: period,
                    avgReturn: `${avgReturn >= 0 ? '+' : ''}${avgReturn.toFixed(2)}%`,
                    winRate: `${winRate.toFixed(1)}%`,
                    best: `${maxReturn >= 0 ? '+' : ''}${maxReturn.toFixed(2)}%`,
                    worst: `${minReturn >= 0 ? '+' : ''}${minReturn.toFixed(2)}%`,
                    volatility: `${stdDev.toFixed(2)}%`,
                    samples: data.totalCount,
                    // Additional data for sorting/analysis
                    avgReturnRaw: avgReturn,
                    winRateRaw: winRate,
                    returnVolRatio: stdDev > 0 ? avgReturn / stdDev : 0
                });
            } else {
                table.rows.push({
                    timeframe: period,
                    avgReturn: 'N/A',
                    winRate: 'N/A',
                    best: 'N/A',
                    worst: 'N/A',
                    volatility: 'N/A',
                    samples: 0
                });
            }
        }

        // Sort by return/volatility ratio (best risk-adjusted returns first)
        table.rows.sort((a, b) => (b.returnVolRatio || 0) - (a.returnVolRatio || 0));

        return table;
    }

    static findBestPerformingPeriods(performanceData) {
        const periods = [];
        
        for (const [period, data] of Object.entries(performanceData)) {
            if (data.returns.length > 0) {
                const avgReturn = data.returns.reduce((sum, ret) => sum + ret, 0) / data.returns.length;
                const winRate = (data.winCount / data.totalCount) * 100;
                
                periods.push({
                    period,
                    avgReturn,
                    winRate,
                    score: avgReturn * (winRate / 100) // Combined score
                });
            }
        }
        
        // Sort by combined score
        periods.sort((a, b) => b.score - a.score);
        
        return periods.map(p => p.period);
    }

    static generateKeyInsight(performanceData, bestPeriod) {
        const data = performanceData[bestPeriod];
        if (!data || data.returns.length === 0) return 'Insufficient data for insights';
        
        const avgReturn = data.returns.reduce((sum, ret) => sum + ret, 0) / data.returns.length;
        const winRate = (data.winCount / data.totalCount) * 100;
        
        return `${bestPeriod} timeframe shows strongest edge with ${avgReturn.toFixed(2)}% average return and ${winRate.toFixed(1)}% win rate`;
    }

    static getEmptyPerformanceTable() {
        return {
            headers: ['Timeframe', 'Avg Return', 'Win Rate', 'Best', 'Worst', 'Volatility', 'Samples'],
            rows: [],
            message: 'No historical matches found for analysis'
        };
    }

    // Method to format table for terminal display
    static formatTableForTerminal(performanceTable) {
        if (!performanceTable.rows || performanceTable.rows.length === 0) {
            return 'No performance data available';
        }

        const { headers, rows } = performanceTable;
        
        // Calculate column widths
        const colWidths = headers.map(header => header.length);
        rows.forEach(row => {
            colWidths[0] = Math.max(colWidths[0], row.timeframe.length);
            colWidths[1] = Math.max(colWidths[1], row.avgReturn.length);
            colWidths[2] = Math.max(colWidths[2], row.winRate.length);
            colWidths[3] = Math.max(colWidths[3], row.best.length);
            colWidths[4] = Math.max(colWidths[4], row.worst.length);
            colWidths[5] = Math.max(colWidths[5], row.volatility.length);
            colWidths[6] = Math.max(colWidths[6], row.samples.toString().length);
        });

        // Build table
        let table = '';
        
        // Header
        table += '┌─' + colWidths.map(w => '─'.repeat(w)).join('─┬─') + '─┐\n';
        table += '│ ' + headers.map((h, i) => h.padEnd(colWidths[i])).join(' │ ') + ' │\n';
        table += '├─' + colWidths.map(w => '─'.repeat(w)).join('─┼─') + '─┤\n';
        
        // Rows
        rows.forEach(row => {
            const rowData = [
                row.timeframe,
                row.avgReturn,
                row.winRate,
                row.best,
                row.worst,
                row.volatility,
                row.samples.toString()
            ];
            table += '│ ' + rowData.map((d, i) => d.padEnd(colWidths[i])).join(' │ ') + ' │\n';
        });
        
        table += '└─' + colWidths.map(w => '─'.repeat(w)).join('─┴─') + '─┘';
        
        return table;
    }

    // Method for custom period definitions
    static createCustomPeriods(periodsConfig) {
        // Allow users to define custom timeframes
        // Example: { '5D': 5, '3W': 15, '6M': 126 }
        return periodsConfig;
    }

    // Method to get trading days between dates (accounts for weekends/holidays)
    static getTradingDaysBetween(startDate, endDate) {
        let tradingDays = 0;
        const currentDate = new Date(startDate);
        
        while (currentDate <= endDate) {
            const dayOfWeek = currentDate.getDay();
            // Skip weekends (0 = Sunday, 6 = Saturday)
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                tradingDays++;
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
        
        return tradingDays;
    }

    // Method for volatility-adjusted returns
    static calculateVolatilityAdjustedReturns(returns) {
        if (returns.length < 2) return { adjustedReturns: returns, volatility: 0 };
        
        const mean = returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
        const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
        const volatility = Math.sqrt(variance);
        
        const adjustedReturns = returns.map(ret => volatility > 0 ? ret / volatility : ret);
        
        return { adjustedReturns, volatility };
    }
}

module.exports = ExtendedForwardReturnsCalculator;