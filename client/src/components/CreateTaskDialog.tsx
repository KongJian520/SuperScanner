import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBackends, useCreateTask, useServerInfo } from '../hooks/use-scanner-api';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { Server, Check, ChevronDown } from 'lucide-react';
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
            <div className="grid gap-2 border rounded-md p-4">
                <Label className="text-base">{t('create_task.workflow_title')}</Label>

                {[
                  {
                    key: 'port',
                    label: t('create_task.workflow_port_scan'),
                    enabled: portScanEnabled,
                    onToggle: setPortScanEnabled,
                    tools: [
                      { id: 'builtin', label: t('create_task.tool_builtin') },
                      ...(nmapAvailable ? [{ id: 'nmap', label: t('create_task.tool_nmap') }] : []),
                    ],
                    selectedTools: portScanTools,
                    onToolToggle: (tool: string) => {
                      setPortScanTools(prev =>
                        prev.includes(tool) ? prev.filter(t => t !== tool) : [...prev, tool]
                      );
                    },
                    hint: t('create_task.nmap_server_hint'),
                  },
                  {
                    key: 'fingerprint',
                    label: t('create_task.workflow_fingerprint'),
                    enabled: fingerprintEnabled,
                    onToggle: setFingerprintEnabled,
                    available: httpxAvailable,
                    tools: [{ id: 'httpx', label: t('create_task.tool_httpx') }],
                    selectedTools: fingerprintTools,
                    onToolToggle: (tool: string) => {
                      setFingerprintTools(prev =>
                        prev.includes(tool) ? [] : [tool]
                      );
                    },
                  },
                  {
                    key: 'poc',
                    label: t('create_task.workflow_poc_verify'),
                    enabled: pocEnabled,
                    onToggle: setPocEnabled,
                    available: nucleiAvailable,
                    tools: [{ id: 'nuclei', label: t('create_task.tool_nuclei') }],
                    selectedTools: pocTools,
                    onToolToggle: (tool: string) => {
                      setPocTools(prev =>
                        prev.includes(tool) ? [] : [tool]
                      );
                    },
                  },
                  {
                    key: 'fscan',
                    label: t('create_task.workflow_fscan'),
                    enabled: fscanEnabled,
                    onToggle: setFscanEnabled,
                    available: fscanAvailable,
                    tools: [{ id: 'fscan', label: t('create_task.tool_fscan') }],
                    selectedTools: fscanTools,
                    onToolToggle: (tool: string) => {
                      setFscanTools(prev =>
                        prev.includes(tool) ? [] : [tool]
                      );
                    },
                  },
                ].map((step, idx, arr) => (
                  <React.Fragment key={step.key}>
                    {idx > 0 && (
                      <div className="flex justify-center">
                        <ChevronDown size={16} className="text-muted-foreground/40" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "flex flex-col gap-2 rounded-md border p-3 transition-colors",
                        step.enabled ? "border-primary/30 bg-primary/[0.02]" : "bg-muted/20"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Switch
                          id={`step-${step.key}`}
                          checked={step.enabled}
                          onCheckedChange={
                            'available' in step && !step.available
                              ? () => {}
                              : step.onToggle
                          }
                          disabled={'available' in step ? !step.available : false}
                        />
                        <Label
                          htmlFor={`step-${step.key}`}
                          className={cn(
                            "text-sm font-medium cursor-pointer select-none",
                            'available' in step && !step.available && "opacity-50 cursor-not-allowed"
                          )}
                          onClick={() => {
                            if ('available' in step && !step.available) return;
                            step.onToggle(!step.enabled);
                          }}
                        >
                          {step.label}
                        </Label>
                      </div>

                      {'available' in step && !step.available ? (
                        <p className="ml-11 text-xs text-muted-foreground">{t('create_task.tool_unavailable')}</p>
                      ) : step.enabled ? (
                        <div className="ml-11 flex flex-col gap-2">
                          <div className="flex flex-wrap gap-2">
                            {step.tools.map((tool) => {
                              const isSelected = step.selectedTools.includes(tool.id);
                              return (
                                <button
                                  key={tool.id}
                                  type="button"
                                  onClick={() => step.onToolToggle(tool.id)}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                                    isSelected
                                      ? "bg-primary/10 border-primary text-primary hover:bg-primary/15"
                                      : "bg-background border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "w-1.5 h-1.5 rounded-full",
                                      isSelected ? "bg-primary" : "bg-muted-foreground/30"
                                    )}
                                  />
                                  {tool.label}
                                </button>
                              );
                            })}
                          </div>
                          {'hint' in step && step.hint && (
                            <p className="text-xs text-muted-foreground">{step.hint}</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                    {idx === arr.length - 1 && step.enabled && (
                      <div className="flex justify-center">
                        <ChevronDown size={16} className="text-primary/40" />
                      </div>
                    )}
                  </React.Fragment>
                ))}
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
