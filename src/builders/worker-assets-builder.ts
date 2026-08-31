export function buildContactJs(): string {
  return `
document.addEventListener('DOMContentLoaded', function() {
  var form = document.querySelector('form[action="/api/contact"]');
  if (!form) return;

  var msgEl = document.createElement('div');
  msgEl.style.cssText = 'display:none;padding:1rem;margin-bottom:1.5rem;font-size:0.875rem;font-weight:500;';

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    var data = {};
    form.querySelectorAll('input, textarea, select').forEach(function(el) {
      data[el.name] = el.value;
    });

    msgEl.style.display = 'none';
    msgEl.style.background = '';
    msgEl.style.color = '';

    try {
      var resp = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      var result = await resp.json();
      if (result.ok) {
        form.innerHTML = '<p style="text-align:center;padding:2rem;">Your message has been sent.</p>';
        var whatsappNumber = form.getAttribute('data-whatsapp');
        if (whatsappNumber) {
          var waText = 'New website enquiry:\\n';
          waText += 'Name: ' + (data.name || '') + '\\n';
          waText += 'Email: ' + (data.email || '') + '\\n';
          if (data.phone) waText += 'Phone: ' + data.phone + '\\n';
          if (data.subject) waText += 'Subject: ' + data.subject + '\\n';
          waText += 'Message: ' + (data.message || '');
          var waUrl = 'https://wa.me/' + whatsappNumber.replace(/[^0-9+]/g, '') + '?text=' + encodeURIComponent(waText);
          window.open(waUrl, '_blank');
        }
      } else {
        msgEl.textContent = result.error || 'Something went wrong. Please try again.';
        msgEl.style.background = '#fef2f2';
        msgEl.style.color = '#991b1b';
        msgEl.style.display = 'block';
        form.parentNode.insertBefore(msgEl, form);
      }
    } catch (err) {
      msgEl.textContent = 'Network error. Please check your connection and try again.';
      msgEl.style.background = '#fef2f2';
      msgEl.style.color = '#991b1b';
      msgEl.style.display = 'block';
      form.parentNode.insertBefore(msgEl, form);
    }
  });
});
`.trim();
}

export function buildStylesCss(cssVars: Record<string, string>): string {
  const varsBlock = Object.entries(cssVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");

  return `:root {
${varsBlock}
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-body);
  color: var(--foreground);
  background: var(--background);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
}

a {
  color: inherit;
  text-decoration: none;
}

.skip-link {
  position: absolute;
  top: -100%;
  left: 0;
  background: var(--foreground);
  color: var(--background);
  padding: 1rem 2rem;
  z-index: 100;
}

.skip-link:focus {
  top: 0;
}

body.no-scroll {
  overflow: hidden;
}

.hamburger {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.hamburger span {
  display: block;
  width: 22px;
  height: 2px;
  background: var(--foreground);
  border-radius: 2px;
  transition: transform 0.3s ease, opacity 0.3s ease;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.hamburger span:nth-child(1) {
  top: 12px;
}

.hamburger span:nth-child(2) {
  top: 19px;
}

.hamburger span:nth-child(3) {
  top: 26px;
}

.hamburger.is-open span:nth-child(1) {
  transform: translateX(-50%) translateY(3.5px) rotate(45deg);
}

.hamburger.is-open span:nth-child(2) {
  opacity: 0;
}

.hamburger.is-open span:nth-child(3) {
  transform: translateX(-50%) translateY(-3.5px) rotate(-45deg);
}

.mobile-nav {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: var(--background);
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.3s ease, visibility 0.3s ease;
}

.mobile-nav.is-open {
  opacity: 1;
  visibility: visible;
}

@media (min-width: 768px) {
  .hamburger,
  .mobile-nav {
    display: none !important;
  }
}
`.trim();
}
