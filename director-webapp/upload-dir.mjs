import fs from "node:fs";

export function ensureDirectoryMiddleware(directory) {
  return function ensureDirectory(_req, _res, next) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      next();
    } catch (error) {
      next(error);
    }
  };
}
