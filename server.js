const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = 'DEHHOODXTR';

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Database
const db = new Database('modqueue.db');

// Create tables
db.exec(`
    CREATE TABLE IF NOT EXISTS commands (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        executed INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS bans (
        roblox_id TEXT PRIMARY KEY,
        username TEXT,
        reason TEXT,
        proof TEXT,
        banned_by TEXT,
        banned_at INTEGER,
        expires_at INTEGER
    );
    
    CREATE TABLE IF NOT EXISTS blacklisted_crews (
        group_id TEXT PRIMARY KEY,
        blacklisted_by TEXT,
        blacklisted_at INTEGER
    );
`);

// Authentication middleware
function authenticate(req, res, next) {
    const secret = req.query.secret || req.body.secret;
    if (secret !== SECRET_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
}

// Routes

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        message: 'Deh Hood Moderation API',
        timestamp: Date.now()
    });
});

// Add command to queue
app.post('/command', authenticate, (req, res) => {
    try {
        const { action, data } = req.body;
        
        if (!action || !data) {
            return res.status(400).json({ error: 'Missing action or data' });
        }
        
        const stmt = db.prepare('INSERT INTO commands (action, data, created_at) VALUES (?, ?, ?)');
        const result = stmt.run(action, JSON.stringify(data), Date.now());
        
        // Update database based on action
        if (action === 'ban') {
            db.prepare(`
                INSERT OR REPLACE INTO bans (roblox_id, username, reason, proof, banned_by, banned_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                data.userId,
                data.username || 'Unknown',
                data.reason,
                data.proof || '',
                data.bannedBy || 'System',
                Date.now(),
                data.expiresAt || null
            );
        } else if (action === 'unban') {
            db.prepare('DELETE FROM bans WHERE roblox_id = ?').run(data.userId);
        } else if (action === 'unbanwave') {
            db.prepare('DELETE FROM bans').run();
        } else if (action === 'blacklistcrew') {
            db.prepare(`
                INSERT OR REPLACE INTO blacklisted_crews (group_id, blacklisted_by, blacklisted_at)
                VALUES (?, ?, ?)
            `).run(data.groupId, data.blacklistedBy || 'System', Date.now());
        } else if (action === 'removecrewblacklist') {
            db.prepare('DELETE FROM blacklisted_crews WHERE group_id = ?').run(data.groupId);
        }
        
        res.json({ 
            success: true, 
            commandId: result.lastInsertRowid 
        });
    } catch (error) {
        console.error('Error adding command:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get pending commands
app.get('/commands', authenticate, (req, res) => {
    try {
        const commands = db.prepare('SELECT * FROM commands WHERE executed = 0 ORDER BY created_at ASC LIMIT 50').all();
        
        const parsed = commands.map(cmd => ({
            id: cmd.id,
            action: cmd.action,
            data: JSON.parse(cmd.data),
            created_at: cmd.created_at
        }));
        
        res.json(parsed);
    } catch (error) {
        console.error('Error fetching commands:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Mark command as executed
app.post('/commands/complete', authenticate, (req, res) => {
    try {
        const { commandId } = req.body;
        
        if (!commandId) {
            return res.status(400).json({ error: 'Missing commandId' });
        }
        
        db.prepare('UPDATE commands SET executed = 1 WHERE id = ?').run(commandId);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking command complete:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all bans
app.get('/bans', authenticate, (req, res) => {
    try {
        const bans = db.prepare('SELECT * FROM bans').all();
        res.json(bans);
    } catch (error) {
        console.error('Error fetching bans:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get blacklisted crews
app.get('/blacklistedcrews', authenticate, (req, res) => {
    try {
        const crews = db.prepare('SELECT * FROM blacklisted_crews').all();
        res.json(crews);
    } catch (error) {
        console.error('Error fetching blacklisted crews:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Clean up old executed commands (run hourly)
setInterval(() => {
    try {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const result = db.prepare('DELETE FROM commands WHERE executed = 1 AND created_at < ?').run(oneDayAgo);
        console.log(`Cleaned up ${result.changes} old commands`);
    } catch (error) {
        console.error('Error cleaning up commands:', error);
    }
}, 60 * 60 * 1000);

// Clean up expired bans (run every minute)
setInterval(() => {
    try {
        const now = Date.now();
        const result = db.prepare('DELETE FROM bans WHERE expires_at IS NOT NULL AND expires_at <= ?').run(now);
        if (result.changes > 0) {
            console.log(`Auto-removed ${result.changes} expired bans`);
        }
    } catch (error) {
        console.error('Error cleaning up expired bans:', error);
    }
}, 60 * 1000);

// Start server
app.listen(PORT, () => {
    console.log(`Moderation API server running on port ${PORT}`);
}); 
