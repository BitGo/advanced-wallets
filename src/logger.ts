import winston from 'winston';

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define level based on environment
const level = () => {
  if (process.env.NODE_ENV === 'test' || process.env.LOG_LEVEL === 'silent') return 'silent';
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to winston
winston.addColors(colors);

// Define the format for the logs
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf((info: winston.Logform.TransformableInfo) => {
    // Handle both string interpolation and object logging
    const message = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);

    // If there are additional arguments, format them
    const args = (info[Symbol.for('splat')] as any[]) || [];
    const formattedMessage =
      args.length > 0 ? message.replace(/%s/g, () => String(args.shift() || '')) : message;

    return `${info.timestamp} ${info.level}: ${formattedMessage}`;
  }),
);

// Define which transports the logger must use
const transports = [
  // Console transport
  new winston.transports.Console(),
  // Error log file transport
  new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
  }),
  // All logs file transport
  new winston.transports.File({ filename: 'logs/all.log' }),
];

// Create the logger instance
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
});

export default logger;
