import pino from 'pino';

const isTest = process.env.NODE_ENV === 'test';
const defaultLevel = isTest ? (process.env.LOG_LEVEL || 'silent') : (process.env.LOG_LEVEL || 'info');

export const logger = pino({
  level: defaultLevel,
  base: isTest ? undefined : { pid: process.pid },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export default logger;
