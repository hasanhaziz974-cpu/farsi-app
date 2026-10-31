// Shared by functions/_middleware.js (the trial check) and functions/admin.js (the admin page).
export const TRIAL_DAYS = 7;
export const DAY = 864e5;
export const CONTACT = 'languageparsa777@gmail.com';

export function accessEmail(request) {
  const direct = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (direct) return direct.trim().toLowerCase();
  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) return '';
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return (JSON.parse(atob(part)).email || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

// The last day of an "allow:" entry (YYYY-MM-DD, Arabic or Persian digits accepted), or null for no end date.
export function lastDay(value) {
  const v = value.trim()
    .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660)
    .replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}
