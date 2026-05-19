let socketIO = null;

// Connect the socket instance only once at startup
export function setSocket(ioInstance) {
  socketIO = ioInstance;
}

export function logEvent(type, message, level = 'INFO') {
  const timestamp = new Date().toLocaleTimeString();

  const colors = {
    INFO: '\x1b[34m',
    SUCCESS: '\x1b[32m',
    ERROR: '\x1b[31m',
    QUEUE: '\x1b[35m',
    RESET: '\x1b[0m',
  };
  const color = colors[level] || colors.RESET;
  console.log(`[${timestamp}] [${color}${type}${colors.RESET}] ${message}`);

  if (socketIO) {
    socketIO.emit('new-log', {
      module: type,
      message: message,
      level: level,
      timestamp: timestamp,
    });
  }
}
