(() => {
  const track = (eventName, params = {}) => {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, params);
  };

  const getPageLocation = (target) => {
    const section = target.closest('section[id], main[id], footer, header, nav');
    if (section?.id) return section.id;
    if (section?.tagName) return section.tagName.toLowerCase();
    return window.location.pathname || '/';
  };

  const getDestination = (link) => {
    try {
      return new URL(link.getAttribute('href'), window.location.href);
    } catch {
      return null;
    }
  };

  const projectMeta = (link, destination) => {
    const path = destination.pathname;
    const text = link.querySelector('h2, h3, strong')?.textContent || link.textContent || '';
    const cleanText = text.replace(/\s+/g, ' ').trim();

    if (path.includes('dragon-ball-sociogram')) {
      return {
        project_name: 'Dragon Ball Sociogram',
        project_category: 'character relationship map'
      };
    }

    if (path.includes('manga-anime-timeline')) {
      return {
        project_name: 'Manga and Anime Timeline',
        project_category: 'timeline'
      };
    }

    if (path.includes('pokedex-type-treemap')) {
      return {
        project_name: 'Pokedex Type Treemap',
        project_category: 'treemap'
      };
    }

    return {
      project_name: cleanText || destination.pathname,
      project_category: 'project'
    };
  };

  document.addEventListener('click', (event) => {
    const control = event.target.closest('a, button');
    if (!control) return;

    const location = getPageLocation(control);
    const shareChannel = control.dataset.shareChannel;

    if (shareChannel) {
      track('social_share_click', {
        platform: shareChannel,
        location,
        destination_url: control.href || window.location.href
      });
      return;
    }

    if (!(control instanceof HTMLAnchorElement)) return;

    const destination = getDestination(control);
    if (!destination) return;

    const destinationUrl = destination.href;
    const isHomepage = ['/', '/index.html'].includes(window.location.pathname);
    const isProjectPage = destination.hostname === window.location.hostname && destination.pathname.startsWith('/projects/');

    if (isHomepage && isProjectPage) {
      track('project_open', {
        ...projectMeta(control, destination),
        location: 'homepage',
        destination_url: destinationUrl
      });
      return;
    }

    const href = control.href;
    const label = control.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
    const isContactLink = href.includes('docs.google.com/forms') || label.includes('get in touch') || label.includes('contact form');

    if (isContactLink) {
      track('contact_click', {
        location,
        destination_url: destinationUrl
      });
      return;
    }

    if (destination.hostname.includes('apps.apple.com')) {
      track('app_store_click', {
        app_name: 'Fuda-kun',
        platform: 'app_store',
        location,
        destination_url: destinationUrl
      });
      return;
    }

    if (destination.hostname && destination.hostname !== window.location.hostname) {
      track('outbound_source_click', {
        location,
        destination_url: destinationUrl
      });
    }
  });
})();
