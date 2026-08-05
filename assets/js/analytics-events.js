(() => {
  const projectDefinitions = [
    {
      id: 'dragon_ball_sociogram',
      name: 'Dragon Ball Sociogram',
      category: 'character relationship map',
      landingPath: '/projects/dragon-ball-sociogram.html',
      interactivePaths: ['/dragonball-character-sociogram/']
    },
    {
      id: 'manga_anime_timeline',
      name: 'Manga and Anime Timeline',
      category: 'timeline',
      landingPath: '/projects/manga-anime-timeline.html',
      interactivePaths: ['/manga-timeline.html']
    },
    {
      id: 'pokedex_type_treemap',
      name: 'Pokedex Type Treemap',
      category: 'treemap',
      landingPath: '/projects/pokedex-type-treemap.html',
      interactivePaths: ['/pokemon_territory_map.html']
    },
    {
      id: 'nintendo_game_universe_map',
      name: 'Nintendo Game Universe Map',
      category: 'bubble map',
      landingPath: '/projects/nintendo-game-universe-map.html',
      interactivePaths: ['/nintendo-game-universe-map.html']
    },
    {
      id: 'gundam_universe_map',
      name: 'Gundam Universe Map',
      category: 'timeline map',
      landingPath: '/projects/gundam-universe-map.html',
      interactivePaths: ['/gundam-universe-map.html']
    }
  ];

  const normalizePath = (pathname) => {
    const path = (pathname || '/').replace(/\/+/g, '/');
    return path.endsWith('/index.html') ? `${path.slice(0, -'index.html'.length)}` : path;
  };

  const pathMatches = (pathname, expectedPath) => {
    const path = normalizePath(pathname);
    const expected = normalizePath(expectedPath);
    return path === expected || path.endsWith(expected);
  };

  const getProjectDefinition = (pathname) => projectDefinitions.find((project) => (
    pathMatches(pathname, project.landingPath)
      || project.interactivePaths.some((path) => pathMatches(pathname, path))
  ));

  const getProjectPageType = (pathname, project) => {
    if (!project) return null;
    return pathMatches(pathname, project.landingPath) ? 'landing' : 'interactive';
  };

  const track = (eventName, params = {}) => {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', eventName, params);
  };

  const currentProject = getProjectDefinition(window.location.pathname);
  const currentPageType = getProjectPageType(window.location.pathname, currentProject);
  const isPreview = new URLSearchParams(window.location.search).get('preview') === '1';
  if (isPreview) return;

  const projectAnalyticsParams = currentProject ? {
    content_group: `project:${currentProject.id}`,
    project_id: currentProject.id,
    project_name: currentProject.name,
    project_category: currentProject.category,
    project_page_type: currentPageType,
    project_surface: window.self !== window.top ? 'embed' : currentPageType,
    canonical_project_path: currentProject.landingPath
  } : {};

  if (currentProject && typeof window.gtag === 'function') {
    window.gtag('set', projectAnalyticsParams);
    track('project_page_view', {
      ...projectAnalyticsParams,
      page_path: window.location.pathname
    });
  }

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
    const project = getProjectDefinition(destination.pathname);
    const text = link.querySelector('h2, h3, strong')?.textContent || link.textContent || '';
    const cleanText = text.replace(/\s+/g, ' ').trim();

    if (project) {
      return {
        project_id: project.id,
        project_name: project.name,
        project_category: project.category,
        canonical_project_path: project.landingPath
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
    const isCopyLink = control.hasAttribute('data-copy-link');

    if (shareChannel || isCopyLink) {
      track('social_share_click', {
        ...projectAnalyticsParams,
        platform: shareChannel || 'copy_link',
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
    const destinationProject = getProjectDefinition(destination.pathname);
    const isProjectPage = destination.hostname === window.location.hostname
      && getProjectPageType(destination.pathname, destinationProject) === 'landing';

    if (control.dataset.event) {
      track(control.dataset.event, {
        ...projectAnalyticsParams,
        location,
        destination_url: destinationUrl,
        ...(destinationProject ? {
          destination_project_id: destinationProject.id,
          destination_project_name: destinationProject.name,
          destination_canonical_project_path: destinationProject.landingPath
        } : {})
      });
      return;
    }

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
        ...projectAnalyticsParams,
        location,
        destination_url: destinationUrl
      });
      return;
    }

    if (destination.hostname.includes('apps.apple.com')) {
      track('app_store_click', {
        ...projectAnalyticsParams,
        app_name: 'Fuda-kun',
        platform: 'app_store',
        location,
        destination_url: destinationUrl
      });
      return;
    }

    if (destination.hostname && destination.hostname !== window.location.hostname) {
      track('outbound_source_click', {
        ...projectAnalyticsParams,
        location,
        destination_url: destinationUrl
      });
    }
  });
})();
