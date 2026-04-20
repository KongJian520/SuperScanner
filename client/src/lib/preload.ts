let routesPreloaded = false;

const routePreloaders = [
  () => import('../views/TasksOverview'),
  () => import('../views/DashboardOverview'),
  () => import('../views/ServersOverview'),
  () => import('../components/CreateTaskDialog'),
  () => import('../routes/TaskDetailRoute'),
  () => import('../routes/TaskResultRoute'),
  () => import('../routes/ServerDetailRoute'),
  () => import('../components/NewBackendDialog'),
  () => import('../views/SettingsView'),
];

export const preloadAllRoutes = () => {
  if (routesPreloaded) return;
  routesPreloaded = true;
  void Promise.allSettled(routePreloaders.map((load) => load()));
};

