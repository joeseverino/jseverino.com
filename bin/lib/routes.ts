// The file under the build output a route is served from: / is index.html, /about/ is
// about/index.html, and a path naming a file (/404.html, /resume.pdf) is that file.
export const routeFile = (pathname: string): string => `${pathname.replace(/^\//, '')}${pathname.endsWith('/') ? 'index.html' : ''}`;
