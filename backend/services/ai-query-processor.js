// ========================================
// AI QUERY PROCESSOR
// File: backend/services/ai-query-processor.js
// ========================================

const axios = require('axios');

class EnhancedAIParser {
    static async processNaturalLanguage(userQuery, userId) {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('AI features not available - OpenAI API key not configured');
        }

        try {
            const systemPrompt = `You are an expert financial analyst that converts natural language queries into structured market event analysis with contextual filters.

Parse user questions into:
1. Base Event Type (required)
2. Symbol/Ticker (required) 
3. Event Parameters (required)
4. Contextual Filters (optional)

BASE EVENT TYPES:
- PERCENT_MOVE: Price moves X% over Y days
- REVERSAL: Opens up/down X% but closes opposite direction
- SECTOR_SPREAD: Performance gap between sectors/ETFs  
- MOMENTUM_BULLISH: Above SMA for X days with <Y% drawdown
- MOMENTUM_BEARISH: Below SMA for X days with <Y% rally
- VOLATILITY_EVENT: VIX-based conditions + price action
- MACRO_EVENT: Economic conditions (CPI, rates, dollar)
- TOY_BAROMETER: Turn of year seasonal analysis (Nov-Jan patterns)

CONTEXTUAL FILTERS:
- EARNINGS_SEASON: During quarterly earnings periods
- FED_MEETING: Around Federal Reserve meeting dates
- OPTIONS_EXPIRATION: During options expiration weeks
- DAY_OF_WEEK: Specific weekdays (Monday, Friday, etc.)
- MONTH_OF_YEAR: Seasonal patterns (January, December, etc.)
- ECONOMIC_RELEASE: Around CPI, NFP, GDP releases
- HOLIDAY_EFFECT: Before/after market holidays

EXAMPLES:
"SPY reversals during earnings season" →
{
  "event_type": "REVERSAL",
  "ticker": "SPY", 
  "parameters": {"open_threshold": 2, "close_threshold": 1, "pattern": "bearish"},
  "context_filters": ["EARNINGS_SEASON"],
  "description": "SPY bearish reversal patterns during earnings season"
}

"Turn of year barometer for this year" →
{
  "event_type": "TOY_BAROMETER",
  "ticker": "SPY",
  "parameters": {"threshold": 3.0, "toy_start": "11-19", "toy_end": "01-19"},
  "context_filters": [],
  "description": "Turn of year seasonal strength analysis"
}

"QQQ momentum on Fed meeting days" →
{
  "event_type": "MOMENTUM_BULLISH",
  "ticker": "QQQ",
  "parameters": {"sma_period": 20, "days": 30},
  "context_filters": ["FED_MEETING"],
  "description": "QQQ bullish momentum around Fed meeting dates"
}

ALWAYS respond with valid JSON in this exact format:
{
  "event_type": "EVENT_TYPE_NAME",
  "ticker": "SYMBOL",
  "parameters": {
    // Event-specific parameters
  },
  "context_filters": ["FILTER1", "FILTER2"],
  "additional_filters": {
    // Optional: day_filter, month_filter, etc.
  },
  "description": "Human readable description",
  "confidence": 0.95,
  "timeframes": ["1D", "2D", "3D", "4D", "1W", "2W", "1M", "2M", "3M", "6M", "12M"]
}

If you can't parse the query, return:
{
  "error": "Could not understand the query",
  "suggestions": ["Try asking about market events like...", "Examples include..."],
  "available_filters": ["earnings season", "Fed meetings", "options expiration", "day of week"]
}`;

            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userQuery }
                ],
                temperature: 0.1,
                max_tokens: 800
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            const aiResponse = response.data.choices[0].message.content;
            
            try {
                const parsedResponse = JSON.parse(aiResponse);
                
                // Validate the response
                if (!this.validateEventType(parsedResponse.event_type)) {
                    throw new Error(`Invalid event type: ${parsedResponse.event_type}`);
                }
                
                // Ensure timeframes are set
                if (!parsedResponse.timeframes) {
                    parsedResponse.timeframes = ["1D", "2D", "3D", "4D", "1W", "2W", "1M", "2M", "3M", "6M", "12M"];
                }
                
                console.log(`🤖 Enhanced AI Parse: "${userQuery}" → ${parsedResponse.event_type} with ${parsedResponse.context_filters?.length || 0} filters`);
                
                return parsedResponse;
                
            } catch (parseError) {
                console.error('Failed to parse AI response:', aiResponse);
                throw new Error('AI response was not valid JSON');
            }

        } catch (error) {
            console.error('Enhanced AI Processing Error:', error.message);
            
            if (error.response?.status === 429) {
                throw new Error('AI service temporarily unavailable - too many requests');
            } else if (error.response?.status === 401) {
                throw new Error('AI service authentication failed');
            } else {
                throw new Error(`Failed to process query: ${error.message}`);
            }
        }
    }

    static validateEventType(eventType) {
        const validTypes = [
            'PERCENT_MOVE',
            'REVERSAL', 
            'SECTOR_SPREAD',
            'MOMENTUM_BULLISH',
            'MOMENTUM_BEARISH',
            'VOLATILITY_EVENT',
            'MACRO_EVENT',
            'TOY_BAROMETER'  // Added your new seasonal analysis
        ];
        
        return validTypes.includes(eventType);
    }

    static validateContextFilter(filter) {
        const validFilters = [
            'EARNINGS_SEASON',
            'FED_MEETING',
            'OPTIONS_EXPIRATION', 
            'DAY_OF_WEEK',
            'MONTH_OF_YEAR',
            'ECONOMIC_RELEASE',
            'HOLIDAY_EFFECT',
            'MARKET_HOURS'
        ];
        
        return validFilters.includes(filter);
    }

    static getAdvancedSuggestions() {
        return [
            // Basic Events
            "What happens when SPY moves up 5% in 3 days?",
            "Show me QQQ reversal patterns where it opens up 3% but closes down",
            
            // With Earnings Context
            "SPY reversals during earnings season",
            "AAPL momentum patterns around earnings announcements",
            "Tech sector performance during Q4 earnings",
            
            // With Fed Meeting Context  
            "QQQ momentum on Fed meeting days",
            "SPY volatility around FOMC announcements",
            "Dollar strength during Fed hiking cycles",
            
            // With Options Expiration
            "Sector spreads during options expiration week",
            "VIX behavior on triple witching days",
            "SPY pin action near major strikes on expiration",
            
            // Day of Week Patterns
            "VIX spikes on Friday vs Monday",
            "SPY performance on Fed announcement Wednesdays",
            "End of month rebalancing effects",
            
            // Seasonal Patterns (NEW)
            "Turn of year barometer signals",
            "Holiday season strength patterns", 
            "November to January performance analysis",
            "TOY barometer predicting Q1 returns",
            
            // Economic Release Context
            "SPY reactions to CPI surprise announcements",
            "Dollar moves on NFP release days",
            "Bond market volatility during inflation reports"
        ];
    }

    static getContextFilterExamples() {
        return {
            "EARNINGS_SEASON": {
                "description": "During quarterly earnings periods",
                "examples": ["earnings season", "around earnings", "during Q4 earnings"]
            },
            "FED_MEETING": {
                "description": "Around Federal Reserve meeting dates",
                "examples": ["Fed meeting days", "FOMC announcements", "Fed decision days"]
            },
            "OPTIONS_EXPIRATION": {
                "description": "During options expiration weeks",
                "examples": ["options expiration", "OpEx week", "triple witching"]
            },
            "DAY_OF_WEEK": {
                "description": "Specific weekdays",
                "examples": ["on Fridays", "Monday effect", "Wednesday patterns"]
            },
            "MONTH_OF_YEAR": {
                "description": "Seasonal patterns",
                "examples": ["January effect", "December rally", "summer doldrums"]
            },
            "ECONOMIC_RELEASE": {
                "description": "Around economic data releases",
                "examples": ["CPI days", "NFP release", "GDP announcements"]
            },
            "HOLIDAY_EFFECT": {
                "description": "Before/after market holidays",
                "examples": ["before Christmas", "post-holiday", "long weekends"]
            }
        };
    }
}

module.exports = EnhancedAIParser;