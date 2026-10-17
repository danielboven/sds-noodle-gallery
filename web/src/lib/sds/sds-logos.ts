import { logoManager, type LogoSet } from '@immich/ui';

// @immich/ui components (e.g. the Modal header icon) render their own built-in
// Immich logos via logoManager. Point them at the SDS logos in web/static, the
// same files the app's own Logo component uses.
const sdsLogos: LogoSet = {
  stacked: { light: '/gallery-logo-stacked.svg', dark: '/gallery-logo-stacked-dark.svg' },
  unstacked: { light: '/gallery-logo-inline-light.svg', dark: '/gallery-logo-inline-dark.svg' },
  stacked_futo: { light: '/gallery-logo-stacked.svg', dark: '/gallery-logo-stacked-dark.svg' },
  icon: '/gallery-logo-mark.svg',
};

logoManager.setLogo(sdsLogos);
