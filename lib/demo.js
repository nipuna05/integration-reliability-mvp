// Two fake systems (HR + Payroll) with an HR -> Payroll sync, so the product can
// be demoed without a real client. Flip `broken` to simulate a silent sync bug:
// every API still returns 200, but payroll receives the wrong salary.

const hr = new Map();
const payroll = new Map();
let nextId = 1;
export const state = { broken: false };

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

export async function handleDemo(req, res, path) {
  if (req.method === 'POST' && path === '/demo/break') {
    state.broken = (await readBody(req)).broken === true;
    return json(res, 200, state);
  }
  if (req.method === 'GET' && path === '/demo/state') return json(res, 200, state);

  if (req.method === 'POST' && path === '/demo/hr/employees') {
    const body = await readBody(req);
    const emp = { id: `E${nextId++}`, name: body.name, salary: body.salary };
    hr.set(emp.id, emp);
    // sync to payroll; the bug silently truncates salary to thousands
    payroll.set(emp.id, { employeeId: emp.id, name: emp.name, monthlySalary: state.broken ? Math.floor(emp.salary / 1000) * 1000 : emp.salary });
    return json(res, 201, emp);
  }

  let m = path.match(/^\/demo\/hr\/employees\/(\w+)$/);
  if (m && req.method === 'GET') {
    return hr.has(m[1]) ? json(res, 200, hr.get(m[1])) : json(res, 404, { error: 'not found' });
  }
  m = path.match(/^\/demo\/payroll\/employees\/(\w+)$/);
  if (m && req.method === 'GET') {
    return payroll.has(m[1]) ? json(res, 200, payroll.get(m[1])) : json(res, 404, { error: 'not found' });
  }
  json(res, 404, { error: 'unknown demo route' });
}
