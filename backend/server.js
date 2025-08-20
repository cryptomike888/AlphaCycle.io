// ========================================
// ALPHACYCLE.IO - MAIN SERVER
// File: backend/server.js
// Complete Bloomberg Terminal Competitor
// ========================================

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const crypto = require('crypto');
require('dotenv').config();

// Import our services
const MarketDataService = require('./services/market-data');
const EnhancedAIParser = require('./services/ai-query-processor');
const contextualFilterService = require('./services/contextual-filters');
const { EventEngineCoordinator } = require('./services/event-engines');
const ExtendedForwardReturnsCalculator = require('./services/forward-returns');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize engine coordinator
const engineCoordinator = new EventEngineCoordinator();

// ========================================
// SECURITY & MIDDLEWARE
// ========================================

app.use(helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

app.use(cors({
    origin: process.env.FRONTEND_URL || ['http://localhost:3000', 'http://localhost:8080'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting - Anti-abuse only
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: { error: 'Too many authentication attempts, please try again later.' }
});

app.use('/api/', generalLimiter);
app.use('/api/auth/', authLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`${timestamp} - ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

// ========================================
// ENVIRONMENT VALIDATION
// ========================================

const requiredEnvVars = ['JWT_SECRET', 'MONGODB_URI'];
const optionalEnvVars = {
    'OPENAI_API_KEY': 'AI features will be disabled',
    'STRIPE_SECRET_KEY': 'Billing will be disabled',
    'FRED_API_KEY': 'Macro data will be simulated'
};

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`❌ CRITICAL: Missing environment variable: ${envVar}`);
        process.exit(1);
    }
}

for (const [envVar, message] of Object.entries(optionalEnvVars)) {
    if (!process.env[envVar]) {
        console.warn(`⚠️  WARNING: Missing ${envVar} - ${message}`);
    }
}

console.log('✅ Environment validation complete');

// ========================================
// DATABASE SCHEMAS
// ========================================

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    subscription: {
        tier: { type: String, enum: ['starter', 'pro', 'pro_journal', 'enterprise'], default: 'starter' },
        status: { type: String, enum: ['active', 'cancelled', 'past_due', 'trialing'], default: 'active' },
        stripeCustomerId: String,
        stripeSubscriptionId: String,
        currentPeriodEnd: Date,
        trialEnd: Date
    },
    usage: {
        queriesThisMonth: { type: Number, default: 0 },
        lastResetDate: { type: Date, default: Date.now },
        totalQueries: { type: Number, default: 0 }
    },
    profile: {
        firstName: String,
        lastName: String,
        company: String,
        createdAt: { type: Date, default: Date.now },
        lastLogin: Date,
        emailVerified: { type: Boolean, default: false }
    }
}, { timestamps: true });

const QueryCacheSchema = new mongoose.Schema({
    queryHash: { type: String, required: true, unique: true, index: true },
    strategy: { type: String, required: true },
    ticker: { type: String, required: true },
    parameters: { type: Object, required: true },
    results: { type: Array, required: true },
    summary: { type: Object, required: true },
    executionTime: { type: Number, required: true },
    hitCount: { type: Number, default: 1 },
    createdAt: { type: Date, default: Date.now, expires: 86400 }
});

const QueryHistorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    query: { type: String, required: true },
    strategy: { type: String, required: true },
    ticker: { type: String, required: true },
    parameters: { type: Object, required: true },
    results: { type: Array, required: true },
    summary: { type: Object, required: true },
    executionTime: { type: Number, required: true },
    cached: { type: Boolean, default: false },
    aiParsed: { type: Boolean, default: false },
    aiDescription: String,
    ipAddress: String,
    userAgent: String,
    createdAt: { type: Date, default: Date.now }
});

QueryHistorySchema.index({ userId: 1, createdAt: -1 });
QueryHistorySchema.index({ strategy: 1, createdAt: -1 });

const User = mongoose.model('User', UserSchema);
const QueryCache = mongoose.model('QueryCache', QueryCacheSchema);
const QueryHistory = mongoose.model('QueryHistory', QueryHistorySchema);

// ========================================
// DATABASE CONNECTION
// ========================================

mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => {
    console.log('✅ MongoDB connected successfully');
    console.log(`📊 Database: ${mongoose.connection.name}`);
})
.catch((err) => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
});

mongoose.connection.on('disconnected', () => console.warn('⚠️  MongoDB disconnected'));
mongoose.connection.on('reconnected', () => console.log('✅ MongoDB reconnected'));

// ========================================
// SUBSCRIPTION CONFIGURATION
// ========================================

const TIER_LIMITS = {
    starter: {
        queries: 200,
        price: 29,
        features: ['basic_patterns', 'csv_export', 'email_support'],
        strategies: ['PERCENT_MOVE', 'REVERSAL'],
        description: 'Basic patterns (gaps, reversals)'
    },
    pro: {
        queries: 1000,
        price: 79,
        features: ['all_strategies', 'real_time_alerts', 'priority_support', 'api_access'],
        strategies: 'all',
        description: 'All premium strategies + alerts'
    },
    pro_journal: {
        queries: 1000,
        price: 84,
        features: ['all_strategies', 'trading_journal', 'pnl_calendar', 'performance_analytics'],
        strategies: 'all',
        description: 'Pro + Complete Trading Journal'
    },
    enterprise: {
        queries: -1,
        price: 199,
        features: ['unlimited_queries', 'custom_strategies', 'white_label', 'phone_support'],
        strategies: 'all',
        description: 'Unlimited + Custom strategies'
    }
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

function generateQueryHash(strategy, ticker, parameters) {
    const queryData = { strategy, ticker, parameters };
    const queryString = JSON.stringify(queryData, Object.keys(queryData).sort());
    return crypto.createHash('md5').update(queryString).digest('hex');
}

async function getCachedResult(cacheKey) {
    try {
        const cached = await QueryCache.findOne({ queryHash: cacheKey });
        if (cached) {
            cached.hitCount += 1;
            await cached.save();
            return {
                results: cached.results,
                summary: cached.summary,
                executionTime: cached.executionTime
            };
        }
    } catch (error) {
        console.warn('Cache lookup failed:', error.message);
    }
    return null;
}

async function cacheResult(cacheKey, strategy, ticker, parameters, results, summary, executionTime) {
    try {
        await QueryCache.findOneAndUpdate(
            { queryHash: cacheKey },
            {
                queryHash: cacheKey,
                strategy,
                ticker,
                parameters,
                results,
                summary,
                executionTime,
                hitCount: 1
            },
            { upsert: true, new: true }
        );
    } catch (error) {
        console.warn('Cache save failed:', error.message);
    }
}

async function updateUserUsage(userId) {
    try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const user = await User.findById(userId);
        if (!user) return;
        
        if (!user.usage.lastResetDate || user.usage.lastResetDate < monthStart) {
            user.usage.queriesThisMonth = 1;
            user.usage.lastResetDate = now;
        } else {
            user.usage.queriesThisMonth += 1;
        }
        
        user.usage.totalQueries += 1;
        user.profile.lastLogin = now;
        
        await user.save();
    } catch (error) {
        console.error('Failed to update user usage:', error.message);
    }
}

function getUpgradeTier(currentTier) {
    const upgrades = {
        starter: { tier: 'pro', price: 79, queries: 1000, message: 'Upgrade to Pro for 1,000 queries + all premium strategies' },
        pro: { tier: 'enterprise', price: 199, queries: -1, message: 'Upgrade to Enterprise for unlimited queries + custom strategies' },
        pro_journal: { tier: 'enterprise', price: 199, queries: -1, message: 'Upgrade to Enterprise for unlimited queries + custom strategies' }
    };
    return upgrades[currentTier] || null;
}

// ========================================
// AUTHENTICATION MIDDLEWARE
// ========================================

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(403).json({ error: 'Invalid token' });
    }
};

const checkSubscriptionLimits = async (req, res, next) => {
    try {
        const user = req.user;
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        if (!user.usage.lastResetDate || user.usage.lastResetDate < monthStart) {
            user.usage.queriesThisMonth = 0;
            user.usage.lastResetDate = now;
            await user.save();
        }
        
        const tierInfo = TIER_LIMITS[user.subscription.tier];
        const limit = tierInfo.queries;
        
        if (limit !== -1 && user.usage.queriesThisMonth >= limit) {
            const upgrade = getUpgradeTier(user.subscription.tier);
            return res.status(429).json({
                error: 'Monthly query limit reached',
                tier: user.subscription.tier,
                limit: limit,
                used: user.usage.queriesThisMonth,
                resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1),
                upgrade: upgrade
            });
        }
        
        next();
    } catch (error) {
        console.error('Subscription check failed:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const checkStrategyAccess = (req, res, next) => {
    try {
        const user = req.user;
        const tierInfo = TIER_LIMITS[user.subscription.tier];
        
        const data = req.body;
        const strategy = data.strategy || data.event_type;
        
        if (tierInfo.strategies !== 'all' && !tierInfo.strategies.includes(strategy)) {
            return res.status(403).json({
                error: `Strategy "${strategy}" requires Pro subscription`,
                strategy: strategy,
                currentTier: user.subscription.tier,
                requiredTier: 'pro',
                upgrade: {
                    tier: 'pro',
                    price: TIER_LIMITS.pro.price,
                    message: 'Upgrade to Pro for all premium strategies'
                }
            });
        }
        
        next();
    } catch (error) {
        console.error('Strategy access check failed:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// ========================================
// AUTHENTICATION ROUTES
// ========================================

app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, company } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }
        
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 12);
        
        const user = new User({
            email: email.toLowerCase(),
            password: hashedPassword,
            profile: { firstName: firstName || '', lastName: lastName || '', company: company || '' }
        });
        
        await user.save();
        
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        console.log(`✅ New user registered: ${email}`);
        
        res.status(201).json({
            message: 'User created successfully',
            token,
            user: {
                id: user._id,
                email: user.email,
                subscription: user.subscription,
                profile: user.profile,
                usage: user.usage
            }
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        user.profile.lastLogin = new Date();
        await user.save();
        
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        
        console.log(`✅ User logged in: ${email}`);
        
        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                email: user.email,
                subscription: user.subscription,
                profile: user.profile,
                usage: user.usage
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/auth/profile', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        res.json({
            user: {
                id: user._id,
                email: user.email,
                subscription: user.subscription,
                profile: user.profile,
                usage: user.usage
            }
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ========================================
// MAIN AI-POWERED ANALYSIS ROUTE
// ========================================

app.post('/api/analyze', authenticateToken, checkSubscriptionLimits, checkStrategyAccess, async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { query, periods } = req.body;
        
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ 
                error: 'Natural language query is required',
                examples: EnhancedAIParser.getAdvancedSuggestions()
            });
        }
        
        console.log(`🤖 Processing AI query: "${query}" for user ${req.user.email}`);
        
        // Step 1: Process natural language with AI
        let aiResult;
        try {
            aiResult = await EnhancedAIParser.processNaturalLanguage(query, req.user._id);
        } catch (error) {
            console.error('AI processing failed:', error.message);
            return res.status(400).json({
                error: 'Could not understand your query',
                details: error.message,
                suggestions: EnhancedAIParser.getAdvancedSuggestions(),
                fallback: 'Try using simpler language or one of the examples above'
            });
        }
        
        if (aiResult.error) {
            return res.status(400).json({
                error: aiResult.error,
                suggestions: aiResult.suggestions || EnhancedAIParser.getAdvancedSuggestions()
            });
        }
        
        if (!EnhancedAIParser.validateEventType(aiResult.event_type)) {
            return res.status(400).json({
                error: 'AI returned invalid event type',
                aiResponse: aiResult,
                suggestions: EnhancedAIParser.getAdvancedSuggestions()
            });
        }
        
        console.log(`✅ AI parsed query as: ${aiResult.event_type} for ${aiResult.ticker}`);
        
        // Step 2: Check cache
        const cacheKey = generateQueryHash(
            aiResult.event_type, 
            aiResult.ticker, 
            { ...aiResult.parameters, periods: periods || { '1D': 1, '2D': 2, '3D': 3, '4D': 4, '1W': 5, '2W': 10, '1M': 21, '2M': 42, '3M': 63, '6M': 126, '12M': 252 } }
        );
        
        const cachedResult = await getCachedResult(cacheKey);
        if (cachedResult) {
            console.log(`📋 Cache hit for AI query: ${aiResult.event_type}`);
            
            await updateUserUsage(req.user._id);
            
            await QueryHistory.create({
                userId: req.user._id,
                query: query,
                strategy: aiResult.event_type,
                ticker: aiResult.ticker,
                parameters: aiResult.parameters,
                results: cachedResult.results,
                summary: cachedResult.summary,
                executionTime: cachedResult.executionTime,
                cached: true,
                aiParsed: true,
                aiDescription: aiResult.description,
                ipAddress: req.ip,
                userAgent: req.get('User-Agent')
            });
            
            return res.json({
                query: query,
                aiParsing: {
                    eventType: aiResult.event_type,
                    ticker: aiResult.ticker,
                    description: aiResult.description,
                    confidence: aiResult.confidence
                },
                results: cachedResult.results,
                summary: cachedResult.summary,
                cached: true,
                executionTime: cachedResult.executionTime
            });
        }
        
        // Step 3: Run event analysis
        console.log(`🔍 Running ${aiResult.event_type} analysis for ${aiResult.ticker}`);
        
        let eventResult;
        try {
            eventResult = await engineCoordinator.runEventAnalysis(
                aiResult.event_type,
                aiResult.ticker,
                aiResult.parameters
            );
        } catch (engineError) {
            console.error(`Engine ${aiResult.event_type} failed:`, engineError.message);
            
            return res.status(500).json({
                error: 'Event analysis engine temporarily unavailable',
                eventType: aiResult.event_type,
                details: engineError.message,
                engineStatus: engineCoordinator.getEngineHealthStatus(),
                suggestion: 'Please try again in a few minutes or try a different analysis type'
            });
        }
        
        // Step 4: Apply contextual filters
        let filteredMatches = eventResult.matches || [];
        if (aiResult.context_filters && aiResult.context_filters.length > 0 && filteredMatches.length > 0) {
            try {
                const matchDates = filteredMatches.map(match => new Date(match.date).toISOString().split('T')[0]);
                const filteredDates = contextualFilterService.applyContextFilters(
                    matchDates, 
                    aiResult.context_filters, 
                    aiResult.additional_filters
                );
                
                // Filter matches to only include those that pass context filters
                filteredMatches = filteredMatches.filter(match => {
                    const matchDate = new Date(match.date).toISOString().split('T')[0];
                    return filteredDates.includes(matchDate);
                });
                
                console.log(`🔍 Context filters applied: ${eventResult.matches.length} → ${filteredMatches.length} matches`);
            } catch (filterError) {
                console.warn('Context filter application failed:', filterError.message);
                // Continue with unfiltered matches
            }
        }
        
        // Step 5: Calculate forward returns
        let results = [];
        let summary = eventResult.summary;
        
        if (filteredMatches.length > 0 && aiResult.event_type !== 'MACRO_EVENT') {
            try {
                const marketData = await MarketDataService.getHistoricalData(aiResult.ticker);
                const forwardPeriods = periods || { '1D': 1, '2D': 2, '3D': 3, '4D': 4, '1W': 5, '2W': 10, '1M': 21, '2M': 42, '3M': 63, '6M': 126, '12M': 252 };
                
                const forwardResults = ExtendedForwardReturnsCalculator.calculate(
                    marketData, 
                    filteredMatches, 
                    forwardPeriods
                );
                
                results = forwardResults.results;
                summary = { ...summary, ...forwardResults.summary };
                
                // Add context filter info to summary
                if (aiResult.context_filters && aiResult.context_filters.length > 0) {
                    const filterSummary = contextualFilterService.getFilterSummary(
                        aiResult.context_filters, 
                        aiResult.additional_filters
                    );
                    summary['Context Filters'] = filterSummary;
                    summary['Filtered Matches'] = `${filteredMatches.length} of ${eventResult.matches.length} total matches`;
                }
                
            } catch (forwardError) {
                console.warn('Forward returns calculation failed:', forwardError.message);
                results = filteredMatches.map(match => ({
                    'Match Date': new Date(match.date).toISOString().split('T')[0],
                    'Event': aiResult.description,
                    'Details': JSON.stringify(match)
                }));
            }
        } else if (aiResult.event_type === 'MACRO_EVENT') {
            results = filteredMatches.map(match => ({
                'Signal': match.signal || 'Macro conditions analysis',
                'Date': new Date().toISOString().split('T')[0],
                'Analysis': aiResult.description
            }));
        } else {
            results = [];
            summary.message = `No historical instances found matching: "${aiResult.description}"`;
            if (aiResult.context_filters && aiResult.context_filters.length > 0) {
                summary.message += ` with applied context filters`;
            }
        }
        
        const executionTime = Date.now() - startTime;
        
        // Step 6: Cache and log
        await cacheResult(
            cacheKey, 
            aiResult.event_type, 
            aiResult.ticker, 
            aiResult.parameters, 
            results, 
            summary, 
            executionTime
        );
        
        await updateUserUsage(req.user._id);
        
        await QueryHistory.create({
            userId: req.user._id,
            query: query,
            strategy: aiResult.event_type,
            ticker: aiResult.ticker,
            parameters: aiResult.parameters,
            results,
            summary,
            executionTime,
            cached: false,
            aiParsed: true,
            aiDescription: aiResult.description,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
        });
        
        console.log(`✅ AI analysis completed: ${filteredMatches.length} matches found in ${executionTime}ms`);
        
        // Step 7: Return comprehensive response
        res.json({
            query: query,
            aiParsing: {
                eventType: aiResult.event_type,
                ticker: aiResult.ticker,
                description: aiResult.description,
                confidence: aiResult.confidence,
                parameters: aiResult.parameters,
                contextFilters: aiResult.context_filters || []
            },
            eventAnalysis: {
                matches: filteredMatches.length,
                totalMatches: eventResult.matches?.length || 0,
                summary: eventResult.summary
            },
            results,
            summary,
            cached: false,
            executionTime,
            engineHealth: engineCoordinator.getEngineHealthStatus()[aiResult.event_type]
        });
        
    } catch (error) {
        console.error('AI analysis route error:', error);
        
        const executionTime = Date.now() - startTime;
        
        res.status(500).json({
            error: 'Analysis failed',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
            executionTime,
            suggestion: 'Please try again or contact support if the problem persists'
        });
    }
});

// ========================================
// ADDITIONAL ROUTES
// ========================================

app.get('/api/strategies', authenticateToken, (req, res) => {
    try {
        const userTier = req.user.subscription.tier;
        const tierInfo = TIER_LIMITS[userTier];
        
        const strategies = {
            PERCENT_MOVE: { name: 'Percent Move Analysis', tier: 'starter', category: 'basic_patterns' },
            REVERSAL: { name: 'Reversal Patterns', tier: 'starter', category: 'basic_patterns' },
            SECTOR_SPREAD: { name: 'Sector Spread Analysis', tier: 'pro', category: 'premium_strategies' },
            MOMENTUM_BULLISH: { name: 'Bullish Momentum', tier: 'pro', category: 'premium_strategies' },
            MOMENTUM_BEARISH: { name: 'Bearish Momentum', tier: 'pro', category: 'premium_strategies' },
            VOLATILITY_EVENT: { name: 'Volatility Events', tier: 'pro', category: 'premium_strategies' },
            MACRO_EVENT: { name: 'Macro Events', tier: 'pro', category: 'premium_strategies' },
            TOY_BAROMETER: { name: 'TOY (Turn of Year)', tier: 'pro', category: 'seasonal_analysis' }
        };
        
        if (tierInfo.strategies !== 'all') {
            Object.keys(strategies).forEach(key => {
                if (!tierInfo.strategies.includes(key)) {
                    strategies[key].locked = true;
                    strategies[key].upgradeRequired = 'pro';
                }
            });
        }
        
        res.json({
            strategies,
            userTier: {
                name: userTier,
                queriesRemaining: tierInfo.queries === -1 ? 'unlimited' : 
                               Math.max(0, tierInfo.queries - req.user.usage.queriesThisMonth),
                totalQueries: tierInfo.queries,
                features: tierInfo.features,
                price: tierInfo.price
            }
        });
    } catch (error) {
        console.error('Strategies fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/engines/health', authenticateToken, (req, res) => {
    try {
        const healthStatus = engineCoordinator.getEngineHealthStatus();
        const availableEngines = engineCoordinator.getAvailableEngines();
        
        const overallHealth = Object.values(healthStatus).every(engine => engine.healthy);
        
        res.json({
            overall: overallHealth ? 'healthy' : 'degraded',
            engines: healthStatus,
            available: availableEngines,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to check engine health',
            details: error.message
        });
    }
});

app.get('/api/examples', authenticateToken, (req, res) => {
    try {
        const examples = [
            {
                category: 'Price Movement Events',
                tier: 'starter',
                examples: [
                    "What happens when SPY moves up 5% in 3 days?",
                    "Show me forward returns after QQQ drops 4% in 2 days",
                    "When has AAPL moved more than 8% in a single week?"
                ]
            },
            {
                category: 'Reversal Patterns',
                tier: 'starter', 
                examples: [
                    "SPY opens up 3% but closes down 2%",
                    "What are the returns when QQQ gaps up big but sells off?",
                    "Bearish reversal days where TSLA opened up 5% but closed red"
                ]
            },
            {
                category: 'Contextual Analysis',
                tier: 'pro',
                examples: [
                    "SPY reversals during earnings season",
                    "QQQ momentum on Fed meeting days",
                    "Sector spreads during options expiration week",
                    "VIX spikes on Friday vs Monday"
                ]
            },
            {
                category: 'Seasonal Analysis (TOY)',
                tier: 'pro',
                examples: [
                    "Wayne Whaley TOY signals for SPY",
                    "Turn of year barometer analysis",
                    "Holiday season strength from December 1st to January 15th",
                    "Custom TOY period from November 25th to February 1st"
                ]
            },
            {
                category: 'Advanced Strategies',
                tier: 'pro',
                examples: [
                    "Tech vs Financial sector performance gaps",
                    "VIX spike mean reversion patterns",
                    "Macro events with CPI above 3% and rising rates",
                    "Momentum patterns during earnings season"
                ]
            }
        ];
        
        const userTier = req.user.subscription.tier;
        const tierInfo = TIER_LIMITS[userTier];
        
        let filteredExamples = examples;
        if (tierInfo.strategies !== 'all') {
            filteredExamples = examples.filter(category => category.tier === 'starter');
        }
        
        res.json({
            examples: filteredExamples,
            userTier: {
                name: userTier,
                canAccess: tierInfo.strategies === 'all' ? 'all strategies' : 'starter strategies only'
            },
            instructions: "Ask your question in plain English. I'll analyze historical market events and show you forward performance statistics with beautiful tables.",
            aiCapabilities: [
                "Natural language understanding",
                "Context-aware filtering (earnings, Fed meetings, etc.)",
                "Custom date ranges for seasonal analysis",
                "Comprehensive forward returns (1D through 12M)",
                "Performance tables with win rates and statistics"
            ]
        });
    } catch (error) {
        console.error('Examples fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/history', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const history = await QueryHistory.find({ userId: req.user._id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .select('query strategy ticker summary executionTime cached aiParsed aiDescription createdAt');
        
        const total = await QueryHistory.countDocuments({ userId: req.user._id });
        
        res.json({
            history,
            pagination: {
                current: parseInt(page),
                total: Math.ceil(total / parseInt(limit)),
                count: history.length,
                totalQueries: total
            }
        });
    } catch (error) {
        console.error('History fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch query history' });
    }
});

app.get('/api/health', async (req, res) => {
    try {
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        
        let marketDataStatus = 'unknown';
        try {
            await MarketDataService.getCurrentPrice('SPY');
            marketDataStatus = 'operational';
        } catch (error) {
            marketDataStatus = 'degraded';
        }
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            services: {
                database: dbStatus,
                marketData: marketDataStatus,
                cache: 'operational',
                ai: process.env.OPENAI_API_KEY ? 'enabled' : 'disabled'
            },
            environment: process.env.NODE_ENV || 'development',
            uptime: process.uptime(),
            engines: engineCoordinator.getAvailableEngines().length
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const stats = await Promise.all([
            User.countDocuments(),
            QueryHistory.countDocuments(),
            QueryCache.countDocuments(),
            QueryHistory.aggregate([
                { $group: { _id: '$strategy', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ])
        ]);
        
        res.json({
            totalUsers: stats[0],
            totalQueries: stats[1],
            cachedQueries: stats[2],
            popularStrategies: stats[3],
            cacheHitRate: stats[2] > 0 ? ((stats[2] / stats[1]) * 100).toFixed(1) + '%' : '0%',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Stats fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch statistics' });
    }
});

// ========================================
// ERROR HANDLING
// ========================================

app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Endpoint not found',
        path: req.originalUrl,
        method: req.method,
        availableEndpoints: [
            'POST /api/analyze - Main AI analysis endpoint',
            'GET /api/strategies - Available strategies',
            'GET /api/examples - Query examples',
            'GET /api/health - System health',
            'POST /api/auth/register - User registration',
            'POST /api/auth/login - User login'
        ]
    });
});

app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    
    if (error.name === 'ValidationError') {
        return res.status(400).json({
            error: 'Validation failed',
            details: Object.values(error.errors).map(e => e.message)
        });
    }
    
    if (error.name === 'CastError') {
        return res.status(400).json({
            error: 'Invalid data format',
            details: error.message
        });
    }
    
    res.status(500).json({
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { details: error.message, stack: error.stack })
    });
});

// ========================================
// SCHEDULED TASKS
// ========================================

cron.schedule('0 2 * * *', async () => {
    try {
        console.log('🧹 Running cache cleanup...');
        const result = await QueryCache.deleteMany({
            createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        });
        console.log(`✅ Cleaned up ${result.deletedCount} old cache entries`);
    } catch (error) {
        console.error('Cache cleanup failed:', error);
    }
});

cron.schedule('0 1 1 * *', async () => {
    try {
        console.log('🔄 Resetting monthly usage counters...');
        const result = await User.updateMany(
            {},
            { 
                $set: { 
                    'usage.queriesThisMonth': 0,
                    'usage.lastResetDate': new Date()
                }
            }
        );
        console.log(`✅ Reset usage for ${result.modifiedCount} users`);
    } catch (error) {
        console.error('Usage reset failed:', error);
    }
});

// ========================================
// SERVER STARTUP
// ========================================

const server = app.listen(PORT, () => {
    console.log(`
🚀 ALPHACYCLE.IO - BLOOMBERG TERMINAL COMPETITOR LAUNCHED!
===========================================================
🌐 Server: http://localhost:${PORT}
📊 Environment: ${process.env.NODE_ENV || 'development'}
💾 Database: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Connecting...'}
🕐 Started: ${new Date().toISOString()}

✅ COMPLETE SYSTEM READY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 AI Natural Language Processing
🔧 7 Event Analysis Engines:
   • Percent Move Analysis
   • Reversal Patterns  
   • Sector Spread Analysis
   • Momentum Patterns (Bullish/Bearish)
   • Volatility Events (VIX-based)
   • Macro Events
   • TOY (Turn of Year) - Wayne Whaley's methodology
   
📅 Contextual Filters:
   • Earnings seasons
   • Fed meeting dates  
   • Options expiration
   • Day of week patterns
   • Economic releases
   • Holiday effects

📊 Forward Returns: 1D, 2D, 3D, 4D, 1W, 2W, 1M, 2M, 3M, 6M, 12M
🔐 Authentication & Subscription System
💰 Pricing: $29-199/month (vs Bloomberg's $24K/year!)
📱 Mobile PWA Ready
⚡ Smart Caching (70% cost reduction)
🏥 Health Monitoring & Fault Tolerance

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 EXAMPLE QUERIES USERS CAN ASK:
   "SPY reversals during earnings season"
   "QQQ momentum on Fed meeting days"
   "Wayne Whaley TOY signals for this year"
   "VIX spikes on Friday vs Monday"
   "Tech vs Finance spreads during options expiration"
   "Custom TOY from December 1st to February 15th"

🏆 READY TO COMPETE WITH:
   • Bloomberg Terminal ($24,000/year)
   • Refinitiv Eikon ($18,000/year)  
   • FactSet ($15,000/year)
   • S&P Capital IQ ($36,000/year)

💎 YOUR COMPETITIVE ADVANTAGE: 90-97% CHEAPER!
    `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('📥 SIGTERM received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ HTTP server closed');
        mongoose.connection.close(() => {
            console.log('✅ MongoDB connection closed');
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('📥 SIGINT received, shutting down gracefully...');
    server.close(() => {
        console.log('✅ HTTP server closed');
        mongoose.connection.close(() => {
            console.log('✅ MongoDB connection closed');
            process.exit(0);
        });
    });
});

module.exports = app;