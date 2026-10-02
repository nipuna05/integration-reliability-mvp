// Validates a user-defined list of checks before it is saved or run.
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function validateChecks(checks) {
  const errors = [];
  if (!Array.isArray(checks)) return ['checks must be a JSON array'];
  const ids = new Set();
  checks.forEach((c, i) => {
    const at = `check ${i + 1}${c && c.name ? ` (${c.name})` : ''}`;
    if (!c || typeof c !== 'object') return errors.push(`${at}: must be an object`);
    if (!c.id || typeof c.id !== 'string') errors.push(`${at}: "id" is required`);
    else if (ids.has(c.id)) errors.push(`${at}: duplicate id "${c.id}"`);
    else ids.add(c.id);
    if (!c.name) errors.push(`${at}: "name" is required`);
    if (!Array.isArray(c.steps) || !c.steps.length) return errors.push(`${at}: needs at least one step`);
    c.steps.forEach((s, j) => {
      const sat = `${at}, step ${j + 1}`;
      if (!s.name) errors.push(`${sat}: "name" is required`);
      if (!s.url || typeof s.url !== 'string') errors.push(`${sat}: "url" is required`);
      else if (!/^(https?:\/\/|\{\{\s*base\s*\}\})/.test(s.url)) errors.push(`${sat}: url must start with http://, https:// or {{base}}`);
      if (s.method && !METHODS.includes(String(s.method).toUpperCase())) errors.push(`${sat}: unknown method "${s.method}"`);
    });
  });
  return errors;
}
