import type { Variants } from 'framer-motion';

export const motionCadence = {
  fast: 0.16,
  normal: 0.26,
  slow: 0.42,
} as const;

export const motionEase = {
  enter: [0.22, 1, 0.36, 1] as const,
  exit: [0.4, 0, 1, 1] as const,
  emphasis: [0.2, 0.8, 0.2, 1] as const,
  nav: 'cubic-bezier(0.22, 1, 0.36, 1)' as const,
} as const;

export const reducedMotionCadence = {
  fast: 0.01,
  normal: 0.01,
  slow: 0.01,
} as const;

export const reducedMotionEasing = 'linear' as const;

export const navMotion = {
  selection: {
    durationMs: 180,
    easing: motionEase.nav,
  },
  indicator: {
    durationMs: 220,
    easing: motionEase.nav,
  },
} as const;

export const routeLite = {
  mainNavSwitch: {
    initial: { opacity: 0.98, y: 2 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: motionCadence.fast, ease: motionEase.enter },
    },
    exit: {
      opacity: 0.99,
      y: -1,
      transition: { duration: 0.1, ease: motionEase.exit },
    },
  } satisfies Variants,
  taskSwitchContainer: {
    initial: { opacity: 1, y: 0, filter: 'blur(0px)' },
    animate: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0 },
    },
    exit: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0 },
    },
  } satisfies Variants,
};

export const sectionEnter = {
  listStagger: {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        staggerChildren: 0.04,
        delayChildren: 0.04,
      },
    },
  } satisfies Variants,
  listItem: {
    hidden: { opacity: 0, y: 8 },
    show: {
      opacity: 1,
      y: 0,
      transition: { duration: motionCadence.normal, ease: motionEase.enter },
    },
  } satisfies Variants,
  detailPanelEnterLeft: {
    initial: { opacity: 0, x: -8 },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: motionCadence.normal, ease: motionEase.enter, delay: 0.04 },
    },
  } satisfies Variants,
  detailPanelEnterRight: {
    initial: { opacity: 0, x: 8 },
    animate: {
      opacity: 1,
      x: 0,
      transition: { duration: motionCadence.normal, ease: motionEase.enter, delay: 0.08 },
    },
  } satisfies Variants,
};

export const microInteraction = {
  cardHoverLift: {
    y: -2,
    scale: 1.005,
    transition: { duration: 0.18, ease: motionEase.enter },
  },
  actionButtonPress: {
    scale: 0.98,
    duration: 0.12,
    ease: motionEase.enter,
  },
  tableSortIcon: {
    duration: 0.16,
    ease: motionEase.enter,
  },
  tableRowReorder: {
    duration: 0.18,
    ease: motionEase.enter,
  },
};

export const stateTransition = {
  surface: {
    initial: { opacity: 0, y: 6, filter: 'blur(2px)' },
    animate: {
      opacity: 1,
      y: 0,
      filter: 'blur(0px)',
      transition: { duration: 0.18, ease: motionEase.enter },
    },
    exit: {
      opacity: 0,
      y: -4,
      filter: 'blur(1px)',
      transition: { duration: 0.14, ease: motionEase.exit },
    },
  } satisfies Variants,
};

// Backward-compatible aliases for legacy callsites.
// Prefer semantic tokens: routeLite, sectionEnter, microInteraction.
/** @deprecated Use routeLite.mainNavSwitch */
export const pageTransition = routeLite.mainNavSwitch;
/** @deprecated Use sectionEnter.listStagger */
export const listStagger = sectionEnter.listStagger;
/** @deprecated Use sectionEnter.listItem */
export const listItem = sectionEnter.listItem;
/** @deprecated Use microInteraction.cardHoverLift */
export const cardHoverLift = microInteraction.cardHoverLift;
/** @deprecated Use sectionEnter.detailPanelEnterLeft */
export const detailPanelEnterLeft = sectionEnter.detailPanelEnterLeft;
/** @deprecated Use sectionEnter.detailPanelEnterRight */
export const detailPanelEnterRight = sectionEnter.detailPanelEnterRight;
