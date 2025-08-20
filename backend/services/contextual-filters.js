// ========================================
// CONTEXTUAL FILTERS SERVICE
// File: backend/services/contextual-filters.js
// ========================================

class ContextualFilterService {
    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 24 * 60 * 60 * 1000; // 24 hours
    }

    // ========================================
    // EARNINGS SEASON FILTERS
    // ========================================
    
    getEarningsSeasonDates(startYear = 2020, endYear = 2024) {
        const cacheKey = `earnings_${startYear}_${endYear}`;
        
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }
        
        const earningsSeasons = [];
        
        for (let year = startYear; year <= endYear; year++) {
            // Q1 Earnings: Mid April to Mid May
            earningsSeasons.push({
                quarter: 'Q1',
                year,
                start: new Date(year, 3, 15), // April 15
                end: new Date(year, 4, 15),   // May 15
                period: `Q1 ${year} Earnings`
            });
            
            // Q2 Earnings: Mid July to Mid August  
            earningsSeasons.push({
                quarter: 'Q2',
                year,
                start: new Date(year, 6, 15), // July 15
                end: new Date(year, 7, 15),   // August 15
                period: `Q2 ${year} Earnings`
            });
            
            // Q3 Earnings: Mid October to Mid November
            earningsSeasons.push({
                quarter: 'Q3', 
                year,
                start: new Date(year, 9, 15),  // October 15
                end: new Date(year, 10, 15),   // November 15
                period: `Q3 ${year} Earnings`
            });
            
            // Q4 Earnings: Mid January to Mid February (of next year)
            if (year < endYear) { // Don't add future Q4
                earningsSeasons.push({
                    quarter: 'Q4',
                    year,
                    start: new Date(year + 1, 0, 15), // January 15 (next year)
                    end: new Date(year + 1, 1, 15),   // February 15 (next year)
                    period: `Q4 ${year} Earnings`
                });
            }
        }
        
        this.cache.set(cacheKey, { data: earningsSeasons, timestamp: Date.now() });
        return earningsSeasons;
    }
    
    isEarningsSeason(date) {
        const earningsSeasons = this.getEarningsSeasonDates();
        return earningsSeasons.some(season => 
            date >= season.start && date <= season.end
        );
    }

    // ========================================
    // FED MEETING FILTERS
    // ========================================
    
    getFedMeetingDates(startYear = 2020, endYear = 2024) {
        const cacheKey = `fed_meetings_${startYear}_${endYear}`;
        
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }
        
        // FOMC Meeting Schedule (typically 8 meetings per year)
        const fedMeetings = [
            // 2020
            { date: new Date(2020, 0, 29), type: 'FOMC Decision', year: 2020 },
            { date: new Date(2020, 2, 15), type: 'Emergency Cut', year: 2020 },
            { date: new Date(2020, 2, 3), type: 'Emergency Cut', year: 2020 },
            { date: new Date(2020, 3, 29), type: 'FOMC Decision', year: 2020 },
            { date: new Date(2020, 5, 10), type: 'FOMC Decision', year: 2020 },
            { date: new Date(2020, 6, 29), type: 'FOMC Decision', year: 2020 },
            { date: new Date(2020, 8, 16), type: 'FOMC Decision', year: 2020 },
            { date: new Date(2020, 10, 5), type: 'FOMC Decision', year: 2020 },
            { date: new Date(2020, 11, 16), type: 'FOMC Decision', year: 2020 },
            
            // 2021
            { date: new Date(2021, 0, 27), type: 'FOMC Decision', year: 2021 },
            { date: new Date(2021, 2, 17), type: 'FOMC Decision', year: 2021 },
            { date: new Date(2021, 3, 28), type: 'FOMC Decision', year: 2021 },
            { date: new Date(2021, 5, 16), type: 'FOMC Decision', year: 2021 },
            { date: new Date(2021, 6, 28), type: 'FOMC Decision', year: 2021 },
            { date: new Date(2021, 8, 22), type: 'FOMC Decision', year: 2021 },
            { date: new Date(2021, 10, 3), type: 'FOMC Decision', year: 2021 },
            { date: new Date(2021, 11, 15), type: 'FOMC Decision', year: 2021 },
            
            // 2022
            { date: new Date(2022, 0, 26), type: 'FOMC Decision', year: 2022 },
            { date: new Date(2022, 2, 16), type: 'FOMC Decision', year: 2022 },
            { date: new Date(2022, 4, 4), type: 'FOMC Decision', year: 2022 },
            { date: new Date(2022, 5, 15), type: 'FOMC Decision', year: 2022 },
            { date: new Date(2022, 6, 27), type: 'FOMC Decision', year: 2022 },
            { date: new Date(2022, 8, 21), type: 'FOMC Decision', year: 2022 },
            { date: new Date(2022, 10, 2), type: 'FOMC Decision', year: 2022 },
            { date: new Date(2022, 11, 14), type: 'FOMC Decision', year: 2022 },
            
            // 2023
            { date: new Date(2023, 1, 1), type: 'FOMC Decision', year: 2023 },
            { date: new Date(2023, 2, 22), type: 'FOMC Decision', year: 2023 },
            { date: new Date(2023, 4, 3), type: 'FOMC Decision', year: 2023 },
            { date: new Date(2023, 5, 14), type: 'FOMC Decision', year: 2023 },
            { date: new Date(2023, 6, 26), type: 'FOMC Decision', year: 2023 },
            { date: new Date(2023, 8, 20), type: 'FOMC Decision', year: 2023 },
            { date: new Date(2023, 10, 1), type: 'FOMC Decision', year: 2023 },
            { date: new Date(2023, 11, 13), type: 'FOMC Decision', year: 2023 },
            
            // 2024
            { date: new Date(2024, 0, 31), type: 'FOMC Decision', year: 2024 },
            { date: new Date(2024, 2, 20), type: 'FOMC Decision', year: 2024 },
            { date: new Date(2024, 4, 1), type: 'FOMC Decision', year: 2024 },
            { date: new Date(2024, 5, 12), type: 'FOMC Decision', year: 2024 },
            { date: new Date(2024, 6, 31), type: 'FOMC Decision', year: 2024 },
            { date: new Date(2024, 8, 18), type: 'FOMC Decision', year: 2024 },
            { date: new Date(2024, 10, 7), type: 'FOMC Decision', year: 2024 },
            { date: new Date(2024, 11, 18), type: 'FOMC Decision', year: 2024 }
        ];
        
        const filteredMeetings = fedMeetings.filter(meeting => 
            meeting.year >= startYear && meeting.year <= endYear
        );
        
        this.cache.set(cacheKey, { data: filteredMeetings, timestamp: Date.now() });
        return filteredMeetings;
    }
    
    isFedMeetingWeek(date) {
        const fedMeetings = this.getFedMeetingDates();
        
        return fedMeetings.some(meeting => {
            const weekStart = new Date(meeting.date);
            weekStart.setDate(weekStart.getDate() - 3); // 3 days before
            
            const weekEnd = new Date(meeting.date);
            weekEnd.setDate(weekEnd.getDate() + 3); // 3 days after
            
            return date >= weekStart && date <= weekEnd;
        });
    }

    // ========================================
    // OPTIONS EXPIRATION FILTERS
    // ========================================
    
    getOptionsExpirationDates(startYear = 2020, endYear = 2024) {
        const cacheKey = `options_exp_${startYear}_${endYear}`;
        
        if (this.cache.has(cacheKey)) {
            const cached = this.cache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }
        }
        
        const expirationDates = [];
        
        for (let year = startYear; year <= endYear; year++) {
            for (let month = 0; month < 12; month++) {
                // Monthly options expire on 3rd Friday of each month
                const thirdFriday = this.getThirdFriday(year, month);
                
                expirationDates.push({
                    date: thirdFriday,
                    type: 'Monthly Options Expiration',
                    year,
                    month: month + 1
                });
                
                // Quarterly expirations (March, June, September, December)
                if ([2, 5, 8, 11].includes(month)) {
                    expirationDates.push({
                        date: thirdFriday,
                        type: 'Quarterly Options Expiration (Triple Witching)',
                        year,
                        month: month + 1,
                        triple_witching: true
                    });
                }
            }
        }
        
        this.cache.set(cacheKey, { data: expirationDates, timestamp: Date.now() });
        return expirationDates;
    }
    
    getThirdFriday(year, month) {
        // Find the third Friday of the month
        const firstDay = new Date(year, month, 1);
        const firstFriday = new Date(year, month, 1 + (5 - firstDay.getDay() + 7) % 7);
        const thirdFriday = new Date(firstFriday);
        thirdFriday.setDate(firstFriday.getDate() + 14);
        return thirdFriday;
    }
    
    isOptionsExpirationWeek(date) {
        const expirations = this.getOptionsExpirationDates();
        
        return expirations.some(exp => {
            const weekStart = new Date(exp.date);
            weekStart.setDate(weekStart.getDate() - 4); // Start of week
            
            const weekEnd = new Date(exp.date);
            weekEnd.setDate(weekEnd.getDate() + 2); // End of week
            
            return date >= weekStart && date <= weekEnd;
        });
    }

    // ========================================
    // DAY OF WEEK FILTERS
    // ========================================
    
    filterByDayOfWeek(dates, targetDays) {
        // targetDays: ['MONDAY', 'FRIDAY', etc.]
        const dayMap = {
            'SUNDAY': 0, 'MONDAY': 1, 'TUESDAY': 2, 'WEDNESDAY': 3,
            'THURSDAY': 4, 'FRIDAY': 5, 'SATURDAY': 6
        };
        
        const targetDayNumbers = targetDays.map(day => dayMap[day.toUpperCase()]);
        
        return dates.filter(date => 
            targetDayNumbers.includes(new Date(date).getDay())
        );
    }

    // ========================================
    // MAIN FILTER APPLICATION
    // ========================================
    
    applyContextFilters(dates, filters, additionalFilters = {}) {
        let filteredDates = [...dates];
        
        for (const filter of filters) {
            switch (filter) {
                case 'EARNINGS_SEASON':
                    filteredDates = filteredDates.filter(dateStr => {
                        const date = new Date(dateStr);
                        return this.isEarningsSeason(date);
                    });
                    break;
                    
                case 'FED_MEETING':
                    filteredDates = filteredDates.filter(dateStr => {
                        const date = new Date(dateStr);
                        return this.isFedMeetingWeek(date);
                    });
                    break;
                    
                case 'OPTIONS_EXPIRATION':
                    filteredDates = filteredDates.filter(dateStr => {
                        const date = new Date(dateStr);
                        return this.isOptionsExpirationWeek(date);
                    });
                    break;
                    
                case 'DAY_OF_WEEK':
                    if (additionalFilters.day_filter) {
                        filteredDates = this.filterByDayOfWeek(filteredDates, additionalFilters.day_filter);
                    }
                    break;
                    
                case 'MONTH_OF_YEAR':
                    if (additionalFilters.month_filter) {
                        filteredDates = filteredDates.filter(dateStr => {
                            const date = new Date(dateStr);
                            const month = date.getMonth() + 1; // 1-12
                            return additionalFilters.month_filter.includes(month);
                        });
                    }
                    break;
                    
                default:
                    console.warn(`Unknown context filter: ${filter}`);
            }
        }
        
        return filteredDates;
    }
    
    getFilterSummary(filters, additionalFilters = {}) {
        const summaries = [];
        
        for (const filter of filters) {
            switch (filter) {
                case 'EARNINGS_SEASON':
                    summaries.push('during quarterly earnings periods');
                    break;
                case 'FED_MEETING':
                    summaries.push('around Federal Reserve meeting dates');
                    break;
                case 'OPTIONS_EXPIRATION':
                    summaries.push('during options expiration weeks');
                    break;
                case 'DAY_OF_WEEK':
                    if (additionalFilters.day_filter) {
                        summaries.push(`on ${additionalFilters.day_filter.join(' and ').toLowerCase()}s`);
                    }
                    break;
                case 'MONTH_OF_YEAR':
                    if (additionalFilters.month_filter) {
                        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                        const months = additionalFilters.month_filter.map(m => monthNames[m-1]);
                        summaries.push(`in ${months.join(' and ')}`);
                    }
                    break;
            }
        }
        
        return summaries.length > 0 ? summaries.join(', ') : '';
    }
    
    clearCache() {
        this.cache.clear();
        console.log('✅ Contextual filter cache cleared');
    }
}

// Singleton instance
const contextualFilterService = new ContextualFilterService();

module.exports = contextualFilterService;