/**
 * The demo, from a browser.
 *
 * No framework and no build step on purpose: what this page is here to show is
 * the API, and anything else would be one more thing to read before getting to
 * it. Every call is same-origin, so the session cookie rides along without
 * `credentials` having to be argued about.
 */

const $ = (id) => document.getElementById(id);

/**
 * Anything that came from the database goes through here before it reaches
 * `innerHTML`. A demo that interpolates a user's own name straight into markup
 * teaches the wrong habit to whoever copies it.
 */
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );

/**
 * Every failure samble answers with is shaped after RFC 9457 — `title`,
 * `detail`, `status`, `code`, plus `errors` naming the field at fault. One
 * parser handles all of them.
 *
 * The exception is the 422 the DTO validator writes before the endpoint runs:
 * it carries `message` instead of `detail`. Both are read here so a form can
 * show either one.
 */
async function call(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = response.status === 204 ? null : await response.json();

  if (!response.ok) {
    throw {
      status: response.status,
      title: payload?.title ?? 'Request failed',
      detail: payload?.detail ?? payload?.message ?? response.statusText,
      errors: payload?.errors ?? null,
    };
  }

  return payload;
}

function showError(element, failure) {
  const fields = failure.errors
    ? Object.entries(failure.errors)
        .map(
          ([field, message]) =>
            `<li><code>${esc(field)}</code> — ${esc(message)}</li>`,
        )
        .join('')
    : '';

  element.innerHTML =
    `<strong>${failure.status} · ${esc(failure.title)}</strong>` +
    esc(failure.detail) +
    (fields ? `<ul>${fields}</ul>` : '');
  element.hidden = false;
}

function hide(...elements) {
  for (const element of elements) element.hidden = true;
}

/* -------------------------------------------------------------- session -- */

let signedIn = false;

async function refreshSession() {
  const me = await call('GET', '/api/auth/me');
  signedIn = me.authenticated;

  if (!signedIn) {
    $('session').innerHTML = '<span class="tag">anonymous</span>';
    $('signed-out').hidden = false;
    $('signed-in').hidden = true;
    return;
  }

  // `permissions` comes back per request, never copied into the session at
  // login: revoke a role and the next request already sees it.
  $('session').innerHTML =
    `<span class="tag">user #${esc(me.userId)}</span>` +
    `<span class="perms">${esc(me.permissions.join(' · '))}</span>` +
    '<button id="logout" class="ghost small" type="button">Sign out</button>';

  $('logout').addEventListener('click', async () => {
    await call('POST', '/api/auth/logout');
    await refreshSession();
  });

  $('signed-out').hidden = true;
  $('signed-in').hidden = false;

  await Promise.all([loadUsers(), loadProducts()]);
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('login-error'));

  const form = new FormData(event.target);

  try {
    await call('POST', '/api/auth/login', {
      username: form.get('username'),
      password: form.get('password'),
    });
    await refreshSession();
  } catch (failure) {
    showError($('login-error'), failure);
  }
});

/* ---------------------------------------------------------------- users -- */

async function loadUsers() {
  hide($('users-error'), $('users-table'));

  try {
    const users = await call('GET', '/api/users');

    // Printed verbatim: the point is what is NOT in it.
    $('users-raw').textContent = JSON.stringify(users, null, 2);

    $('users-table').querySelector('tbody').innerHTML = users
      .map(
        (user) =>
          `<tr><td>${esc(user.id)}</td><td>${esc(user.username)}</td>` +
          `<td>${esc(user.fullName)}</td><td>${esc(user.role)}</td></tr>`,
      )
      .join('');
    $('users-table').hidden = false;
  } catch (failure) {
    $('users-raw').textContent = '';
    showError($('users-error'), failure);
  }
}

$('create-user-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  hide($('create-user-result'));

  const form = new FormData(event.target);
  const result = $('create-user-result');

  try {
    const created = await call('POST', '/api/users', {
      username: form.get('username'),
      fullName: form.get('fullName'),
      password: form.get('password'),
      role: form.get('role'),
    });

    result.className = 'result';
    // textContent, so this one needs no escaping at all.
    result.textContent = `Created #${created.id} — ${created.fullName}`;
    result.hidden = false;
    await loadUsers();
  } catch (failure) {
    result.className = 'error';
    showError(result, failure);
  }
});

/* ------------------------------------------------------------- products -- */

async function loadProducts() {
  hide($('products-error'), $('products-table'));

  try {
    const products = await call('GET', '/api/products');

    $('products-table').querySelector('tbody').innerHTML = products
      .map(
        (product) =>
          `<tr><td>${esc(product.id)}</td><td>${esc(product.name)}</td>` +
          `<td>${esc(product.stock)}</td><td>` +
          `<button class="small" data-restock="${esc(product.id)}" ` +
          'type="button">' +
          '+5</button></td></tr>',
      )
      .join('');
    $('products-table').hidden = false;
  } catch (failure) {
    showError($('products-error'), failure);
  }
}

// One listener on the table instead of one per row: the rows are replaced on
// every reload, and a listener per row would be rebound every time.
$('products-table').addEventListener('click', async (event) => {
  const id = event.target.dataset?.restock;
  if (!id) return;

  hide($('products-error'));

  try {
    await call('POST', `/api/products/${id}/restock`, { quantity: 5 });
    await loadProducts();
  } catch (failure) {
    showError($('products-error'), failure);
  }
});

void refreshSession();
