
// logger.js - Logging system for X Auto DM Extension

class Logger {
  /**
   * Log levels: INFO, WARN, ERROR, DEBUG
   */
  static async log(level, message, data = {}) {
    const entry = {
      timestamp: Date.now(),
      level,
      message,
      data
    };
    
    try {
      const { logs = [] } = await chrome.storage.local.get(['logs']);
      logs.push(entry);
      
      // Keep only last 1000 entries to prevent storage overflow
      if (logs.length > 1000) {
        logs.splice(0, logs.length - 1000);
      }
      
      await chrome.storage.local.set({ logs });
      
      // Also log to console for debugging
      const color = {
        INFO: 'color: #2196F3',
        WARN: 'color: #FF9800',
        ERROR: 'color: #F44336',
        DEBUG: 'color: #9E9E9E'
      }[level] || '';
      
      console.log(`%c[${level}] ${message}`, color, data);
    } catch (err) {
      console.error('Logger failed:', err);
    }
  }
  
  static info(message, data = {}) {
    return this.log('INFO', message, data);
  }
  
  static warn(message, data = {}) {
    return this.log('WARN', message, data);
  }
  
  static error(message, data = {}) {
    return this.log('ERROR', message, data);
  }
  
  static debug(message, data = {}) {
    return this.log('DEBUG', message, data);
  }
  
  /**
   * Get logs with optional filtering
   */
  static async getLogs(filter = {}) {
    const { logs = [] } = await chrome.storage.local.get(['logs']);
    
    let filtered = logs;
    
    if (filter.level) {
      filtered = filtered.filter(log => log.level === filter.level);
    }
    
    if (filter.since) {
      filtered = filtered.filter(log => log.timestamp >= filter.since);
    }
    
    if (filter.until) {
      filtered = filtered.filter(log => log.timestamp <= filter.until);
    }
    
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(log => 
        log.message.toLowerCase().includes(searchLower) ||
        JSON.stringify(log.data).toLowerCase().includes(searchLower)
      );
    }
    
    return filtered;
  }
  
  /**
   * Clear all logs
   */
  static async clearLogs() {
    await chrome.storage.local.set({ logs: [] });
    console.log('All logs cleared');
  }
  
  /**
   * Export logs as JSON
   */
  static async exportLogs() {
    const logs = await this.getLogs();
    const json = JSON.stringify(logs, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `autodm-logs-${Date.now()}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  }
  
  /**
   * Get log statistics
   */
  static async getStats() {
    const logs = await this.getLogs();
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    
    const stats = {
      total: logs.length,
      byLevel: {
        INFO: 0,
        WARN: 0,
        ERROR: 0,
        DEBUG: 0
      },
      last24h: {
        total: 0,
        errors: 0
      }
    };
    
    logs.forEach(log => {
      stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
      
      if (log.timestamp >= oneDayAgo) {
        stats.last24h.total++;
        if (log.level === 'ERROR') {
          stats.last24h.errors++;
        }
      }
    });
    
    return stats;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Logger;
}

