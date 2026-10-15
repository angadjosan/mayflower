/** Absolute URL on the public app. Behind a tunnel or `next start -H 0.0.0.0`, req.url carries the bind address (0.0.0.0:3030), not the public host. */
export const appUrl = (path: string, req: Request) => new URL(path, process.env.APP_URL || req.url);
