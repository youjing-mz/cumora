/** Same-origin URLs for moving between the workspace and the admin portal.
 * Keeping the switch on one origin preserves the bearer token in localStorage. */

export function getWorkspaceHref(): string {
  if (typeof location === 'undefined') return '/'
  if (location.hostname.startsWith('admin.')) return `${location.origin}/?workspace=1`
  return `${location.origin}/`
}

export function getAdminHref(): string {
  if (typeof location === 'undefined') return '/admin/'
  return `${location.origin}/admin/`
}
