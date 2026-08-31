const publishableKey = document.querySelector('meta[name="recipeboy-clerk-publishable-key"]')?.content || '';

function clerkDomainFromKey(key) {
  try {
    return atob(String(key).split('_')[2]).slice(0, -1);
  } catch {
    return '';
  }
}

function loadScript(src, { marker, key } = {}) {
  return new Promise((resolve, reject) => {
    const existing = marker ? document.querySelector(`script[data-recipeboy-clerk="${marker}"]`) : null;
    if (existing) {
      if (existing.dataset.loaded === 'true') return resolve();
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    if (marker) script.dataset.recipeboyClerk = marker;
    if (key) script.dataset.clerkPublishableKey = key;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error('Could not load sign-in.')), { once: true });
    document.head.appendChild(script);
  });
}

function userModel(clerk) {
  const user = clerk?.user || null;
  if (!user) return null;
  const email = user.primaryEmailAddress?.emailAddress || '';
  const label = user.firstName || user.fullName || email.split('@')[0] || 'Friend';
  const initials = (user.firstName?.[0] || user.fullName?.[0] || email[0] || 'R').toUpperCase();
  return { id: user.id, label, email, initials };
}

function returnUrl() {
  return location.href;
}

export async function initAuth({ onChange = () => {} } = {}) {
  const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (isLocal && new URLSearchParams(location.search).get('auth') === 'dev') {
    let signedIn = true;
    const devUser = { id: 'dev_user', label: 'Dev friend', email: '', initials: 'D' };
    const client = {
      get user() { return signedIn ? devUser : null; },
      async getToken() { return signedIn ? 'dev-token' : null; },
      async signIn() { signedIn = true; onChange(devUser); },
      async signOut() { signedIn = false; onChange(null); },
      async openAccount() {},
    };
    return client;
  }
  if (!publishableKey) throw new Error('Recipeboy sign-in is not configured.');
  const clerkDomain = clerkDomainFromKey(publishableKey);
  if (!clerkDomain) throw new Error('Recipeboy sign-in is misconfigured.');

  await loadScript(`https://${clerkDomain}/npm/@clerk/ui@1/dist/ui.browser.js`, { marker: 'ui' });
  await loadScript(`https://${clerkDomain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, {
    marker: 'js',
    key: publishableKey,
  });

  let clerk = globalThis.Clerk;
  if (typeof clerk === 'function') clerk = new clerk(publishableKey);
  await clerk.load({
    publishableKey,
    ui: { ClerkUI: window.__internal_ClerkUICtor },
    appearance: {
      variables: {
        colorPrimary: '#195ccb',
        colorText: '#102a5a',
        colorBackground: '#fffdf4',
        borderRadius: '16px',
        fontFamily: 'Nunito, system-ui, sans-serif',
      },
    },
  });

  if (typeof clerk.addListener === 'function') {
    clerk.addListener(() => onChange(userModel(clerk)));
  }

  return {
    get user() { return userModel(clerk); },
    async getToken(options) { return clerk?.session?.getToken ? clerk.session.getToken(options) : null; },
    async signIn() {
      const redirect = returnUrl();
      return clerk.openSignIn({
        fallbackRedirectUrl: redirect,
        forceRedirectUrl: redirect,
        signUpFallbackRedirectUrl: redirect,
        signUpForceRedirectUrl: redirect,
      });
    },
    async signOut() { return clerk.signOut({ redirectUrl: returnUrl() }); },
    async openAccount() { return clerk.openUserProfile(); },
  };
}
