import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { motion } from 'framer-motion';
import { Settings2 } from 'lucide-react';
import { useAppStore } from '../lib/store';
import { useBackends } from '../hooks/use-scanner-api';
import { routeLite } from '../lib/motion';

export const SettingsView: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const { data: backends = [] } = useBackends();
  const { motionLevel, setMotionLevel, defaultBackendId, setDefaultBackendId } = useAppStore();

  return (
    <motion.div
      className="p-3 sm:p-6 overflow-y-auto h-full"
      variants={routeLite.mainNavSwitch}
      initial="initial"
      animate="animate"
    >
      <div className="max-w-3xl space-y-3 sm:space-y-4">
        <div className="flex items-center gap-2">
          <Settings2 size={18} className="text-muted-foreground" />
          <h2 className="text-xl font-bold text-foreground">{t('settings.title')}</h2>
        </div>

        <div className="rounded-xl border border-border bg-card/70 p-3 sm:p-4 space-y-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('settings.language')}</label>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={i18n.language.startsWith('zh') ? 'zh' : 'en'}
              onChange={(e) => { void i18n.changeLanguage(e.target.value); }}
            >
              <option value="zh">{t('common.chinese')}</option>
              <option value="en">{t('common.english')}</option>
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('settings.theme')}</label>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={theme === 'light' ? 'light' : 'dark'}
              onChange={(e) => setTheme(e.target.value)}
            >
              <option value="dark">{t('activity_bar.dark_mode')}</option>
              <option value="light">{t('activity_bar.light_mode')}</option>
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('settings.motion')}</label>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={motionLevel}
              onChange={(e) => setMotionLevel(e.target.value as 'full' | 'reduced')}
            >
              <option value="full">{t('settings.motion_full')}</option>
              <option value="reduced">{t('settings.motion_reduced')}</option>
            </select>
          </div>

          <div className="grid gap-2">
            <label className="text-sm font-medium text-foreground">{t('settings.default_backend')}</label>
            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={defaultBackendId ?? ''}
              onChange={(e) => setDefaultBackendId(e.target.value || null)}
            >
              <option value="">{t('settings.default_backend_auto')}</option>
              {backends.map((backend) => (
                <option key={backend.id} value={backend.id}>
                  {backend.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default SettingsView;
