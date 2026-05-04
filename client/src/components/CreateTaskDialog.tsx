import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBackends, useCreateTask, useServerInfo } from '../hooks/use-scanner-api';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Server, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ScanType, Workflow, WorkflowStep } from '../types';
import { useAppStore } from '../lib/store';

export const CreateTaskDialog: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: availableBackends = [] } = useBackends();
  const { defaultBackendId } = useAppStore();
  const { mutateAsync: createTask, isPending: isSubmitting } = useCreateTask();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetString, setTargetString] = useState('');
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);
  const { data: serverInfo } = useServerInfo(selectedBackendId);

  const [portScanEnabled, setPortScanEnabled] = useState(true);
  const [portScanTools, setPortScanTools] = useState<string[]>(['builtin']);
  const [fingerprintEnabled, setFingerprintEnabled] = useState(false);
  const [fingerprintTools, setFingerprintTools] = useState<string[]>(['httpx']);
  const [pocEnabled, setPocEnabled] = useState(false);
  const [pocTools, setPocTools] = useState<string[]>(['nuclei']);
  const [fscanEnabled, setFscanEnabled] = useState(false);
  const [fscanTools, setFscanTools] = useState<string[]>(['fscan']);
  const [workflowTab, setWorkflowTab] = useState<'port' | 'fingerprint' | 'poc' | 'fscan'>('port');

  const availableToolSet = React.useMemo(() => {
    const available = (serverInfo?.tools ?? []).filter((tool) => tool.available).map((tool) => tool.toolId);
    return new Set(available);
  }, [serverInfo?.tools]);
  const nmapAvailable = availableToolSet.has('nmap');
  const httpxAvailable = availableToolSet.has('httpx');
  const nucleiAvailable = availableToolSet.has('nuclei');
  const fscanAvailable = availableToolSet.has('fscan');

  const handleCancel = () => navigate('/tasks');

  React.useEffect(() => {
    if (!fingerprintEnabled || httpxAvailable) return;
    setFingerprintEnabled(false);
    setFingerprintTools([]);
  }, [fingerprintEnabled, httpxAvailable]);

  React.useEffect(() => {
    if (!pocEnabled || nucleiAvailable) return;
    setPocEnabled(false);
    setPocTools([]);
  }, [pocEnabled, nucleiAvailable]);

  React.useEffect(() => {
    if (!fscanEnabled || fscanAvailable) return;
    setFscanEnabled(false);
    setFscanTools([]);
  }, [fscanEnabled, fscanAvailable]);

  React.useEffect(() => {
    if (selectedBackendId && availableBackends.some((backend) => backend.id === selectedBackendId)) return;
    const preferred =
      availableBackends.find((backend) => backend.id === defaultBackendId)
      ?? availableBackends[0];
    setSelectedBackendId(preferred?.id ?? null);
  }, [availableBackends, defaultBackendId, selectedBackendId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!targetString) return;
    const targets = targetString.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    if (targets.length === 0) return;
    
    if (!selectedBackendId) {
        toast.error(t('create_task.error_select_backend'));
        return;
    }

    const steps: WorkflowStep[] = [];
    if (portScanEnabled) {
        if (portScanTools.length === 0) {
            toast.error(t('create_task.error_select_port_tool'));
            return;
        }
        portScanTools.forEach(tool => steps.push({ type: ScanType.Port, tool }));
    }
    if (fingerprintEnabled) {
        if (fingerprintTools.length === 0) {
            toast.error(t('create_task.error_select_fingerprint_tool'));
            return;
        }
        fingerprintTools.forEach(tool => steps.push({ type: ScanType.Fingerprint, tool }));
    }
    if (pocEnabled) {
        if (pocTools.length === 0) {
            toast.error(t('create_task.error_select_poc_tool'));
            return;
        }
        pocTools.forEach(tool => steps.push({ type: ScanType.Poc, tool }));
    }
    if (fscanEnabled) {
        if (fscanTools.length === 0) {
            toast.error(t('create_task.error_select_fscan_tool'));
            return;
        }
        fscanTools.forEach(tool => steps.push({ type: ScanType.Fscan, tool }));
    }
    if (steps.length === 0) {
        toast.error(t('create_task.error_select_workflow_step'));
        return;
    }

    const workflow: Workflow = { steps };

    try {
      const res = await createTask({
        name: name || t('create_task.default_name', { target: targets[0] }),
        description,
        targets,
        workflow,
        backendId: selectedBackendId
      });
      navigate(`/task/${res.id}`);
    } catch (e) {
      // Error handled by hook toast
    }
  };

  return (
    <Dialog open={true} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="sm:max-w-[600px] border-border/60 bg-background/95 supports-[backdrop-filter]:bg-background/85 backdrop-blur-sm data-[state=open]:duration-300 data-[state=closed]:duration-200 data-[state=open]:slide-in-from-top-2 data-[state=closed]:slide-out-to-top-2">
        <DialogHeader className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:[animation-delay:40ms] motion-safe:[animation-fill-mode:both]">
          <DialogTitle>{t('create_task.title')}</DialogTitle>
          <DialogDescription>
            {t('create_task.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:[animation-delay:110ms] motion-safe:[animation-fill-mode:both]">
            {/* Targets */}
            <div className="grid gap-2">
                <Label htmlFor="targets" className="text-base">{t('create_task.targets_label')}</Label>
                <Input
                    id="targets"
                    value={targetString}
                    onChange={(e) => setTargetString(e.target.value)}
                    placeholder={t('create_task.targets_placeholder')}
                    className="font-mono"
                    autoFocus
                    disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground">
                    {t('create_task.targets_help')}
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="name">{t('create_task.name_label')}</Label>
                    <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder={t('create_task.name_placeholder')}
                        disabled={isSubmitting}
                    />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="desc">{t('create_task.desc_label')}</Label>
                    <Input
                        id="desc"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder={t('create_task.desc_placeholder')}
                        disabled={isSubmitting}
                    />
                </div>
            </div>

            {/* Workflow Configuration */}
            <div className="grid gap-4 border rounded-md p-4">
                <Label className="text-base">{t('create_task.workflow_title')}</Label>
                <div className="grid grid-cols-4 gap-2 rounded-md bg-muted/40 p-1">
                  {[
                    { key: 'port', label: t('create_task.workflow_port_scan') },
                    { key: 'fingerprint', label: t('create_task.workflow_fingerprint') },
                    { key: 'poc', label: t('create_task.workflow_poc_verify') },
                    { key: 'fscan', label: t('create_task.workflow_fscan') },
                  ].map((tab) => (
                    <Button
                      key={tab.key}
                      type="button"
                      variant={workflowTab === tab.key ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setWorkflowTab(tab.key as 'port' | 'fingerprint' | 'poc' | 'fscan')}
                      className="h-8"
                    >
                      {tab.label}
                    </Button>
                  ))}
                </div>

                {workflowTab === 'port' && (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="scan-port"
                        checked={portScanEnabled}
                        onChange={e => setPortScanEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      />
                      <Label htmlFor="scan-port" className="font-semibold">{t('create_task.workflow_port_scan')}</Label>
                    </div>
                    {portScanEnabled && (
                      <div className="ml-6 flex flex-col gap-2">
                        <div className="flex gap-4">
                          {['builtin', ...(nmapAvailable ? ['nmap'] : [])].map((tool) => (
                            <label key={tool} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input
                                type="checkbox"
                                checked={portScanTools.includes(tool)}
                                onChange={e => {
                                  if (e.target.checked) setPortScanTools([...portScanTools, tool]);
                                  else setPortScanTools(portScanTools.filter(t => t !== tool));
                                }}
                                className="h-3 w-3 rounded border-border"
                              />
                              {tool === 'builtin' ? t('create_task.tool_builtin') : t('create_task.tool_nmap')}
                            </label>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground">{t('create_task.nmap_server_hint')}</p>
                      </div>
                    )}
                  </div>
                )}

                {workflowTab === 'fingerprint' && (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="scan-fingerprint"
                        checked={fingerprintEnabled}
                        disabled={!httpxAvailable}
                        onChange={e => setFingerprintEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
                      />
                      <Label htmlFor="scan-fingerprint" className="font-semibold">{t('create_task.workflow_fingerprint')}</Label>
                    </div>
                    {!httpxAvailable ? (
                      <p className="ml-6 text-xs text-muted-foreground">{t('create_task.tool_unavailable')}</p>
                    ) : (
                      fingerprintEnabled && (
                        <div className="ml-6 flex gap-4">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={fingerprintTools.includes('httpx')}
                              onChange={e => {
                                if (e.target.checked) setFingerprintTools(['httpx']);
                                else setFingerprintTools([]);
                              }}
                              className="h-3 w-3 rounded border-border"
                            />
                            {t('create_task.tool_httpx')}
                          </label>
                        </div>
                      )
                    )}
                  </div>
                )}

                {workflowTab === 'poc' && (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="scan-poc"
                        checked={pocEnabled}
                        disabled={!nucleiAvailable}
                        onChange={e => setPocEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
                      />
                      <Label htmlFor="scan-poc" className="font-semibold">{t('create_task.workflow_poc_verify')}</Label>
                    </div>
                    {!nucleiAvailable ? (
                      <p className="ml-6 text-xs text-muted-foreground">{t('create_task.tool_unavailable')}</p>
                    ) : (
                      pocEnabled && (
                        <div className="ml-6 flex gap-4">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={pocTools.includes('nuclei')}
                              onChange={e => {
                                if (e.target.checked) setPocTools(['nuclei']);
                                else setPocTools([]);
                              }}
                              className="h-3 w-3 rounded border-border"
                            />
                            {t('create_task.tool_nuclei')}
                          </label>
                        </div>
                      )
                    )}
                  </div>
                )}

                {workflowTab === 'fscan' && (
                  <div className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="scan-fscan"
                        checked={fscanEnabled}
                        disabled={!fscanAvailable}
                        onChange={e => setFscanEnabled(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
                      />
                      <Label htmlFor="scan-fscan" className="font-semibold">{t('create_task.workflow_fscan')}</Label>
                    </div>
                    {!fscanAvailable ? (
                      <p className="ml-6 text-xs text-muted-foreground">{t('create_task.tool_unavailable')}</p>
                    ) : (
                      fscanEnabled && (
                        <div className="ml-6 flex gap-4">
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              checked={fscanTools.includes('fscan')}
                              onChange={e => {
                                if (e.target.checked) setFscanTools(['fscan']);
                                else setFscanTools([]);
                              }}
                              className="h-3 w-3 rounded border-border"
                            />
                            {t('create_task.tool_fscan')}
                          </label>
                        </div>
                      )
                    )}
                  </div>
                )}
            </div>

            {/* Backend Selection */}
            <div className="grid gap-2">
                <Label>{t('create_task.select_backend')}</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1">
                    {availableBackends.length === 0 && (
                        <div className="col-span-2 p-4 border border-dashed rounded-md text-center text-sm text-muted-foreground">
                            {t('create_task.no_backends')}
                        </div>
                    )}
                    {availableBackends.map((backend) => (
                        <div
                            key={backend.id}
                            onClick={() => setSelectedBackendId(backend.id)}
                            className={cn(
                                "cursor-pointer rounded-lg border p-3 hover:bg-accent transition-all flex items-start gap-3 relative",
                                selectedBackendId === backend.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"
                            )}
                        >
                            <div className={cn("mt-0.5 p-1.5 rounded-md", selectedBackendId === backend.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                                <Server size={16} />
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <div className="font-medium text-sm truncate">{backend.name}</div>
                                <div className="text-xs text-muted-foreground truncate">{backend.address}</div>
                            </div>
                            {selectedBackendId === backend.id && (
                                <div className="absolute top-2 right-2 text-primary">
                                    <Check size={14} />
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>

        <DialogFooter className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:[animation-delay:180ms] motion-safe:[animation-fill-mode:both]">
          <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            {t('create_task.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!targetString || !selectedBackendId || isSubmitting}>
            {isSubmitting ? t('create_task.creating') : t('create_task.start_scan')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTaskDialog;
