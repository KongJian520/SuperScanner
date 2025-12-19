import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useBackends, useCreateTask } from '../hooks/use-scanner-api';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Server, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ScanType, Workflow, WorkflowStep } from '../types';

export const CreateTaskDialog: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: availableBackends = [] } = useBackends();
  const { mutateAsync: createTask, isPending: isSubmitting } = useCreateTask();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetString, setTargetString] = useState('');
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);

  const [portScanEnabled, setPortScanEnabled] = useState(true);
  const [portScanTools, setPortScanTools] = useState<string[]>(['builtin']);
  const [fingerprintEnabled, setFingerprintEnabled] = useState(false);
  const [fingerprintTools, setFingerprintTools] = useState<string[]>(['builtin']);
  const [pocEnabled, setPocEnabled] = useState(false);
  const [pocTools, setPocTools] = useState<string[]>(['builtin']);

  const handleCancel = () => navigate('/tasks');

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
        portScanTools.forEach(tool => steps.push({ type: ScanType.Port, tool }));
    }
    if (fingerprintEnabled) {
        fingerprintTools.forEach(tool => steps.push({ type: ScanType.Fingerprint, tool }));
    }
    if (pocEnabled) {
        pocTools.forEach(tool => steps.push({ type: ScanType.Poc, tool }));
    }

    const workflow: Workflow = { steps };

    try {
      const res = await createTask({
        name: name || `Scan ${targets[0]}`,
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
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t('create_task.title')}</DialogTitle>
          <DialogDescription>
            {t('create_task.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
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
                <Label className="text-base">Workflow Configuration</Label>
                
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <input 
                            type="checkbox" 
                            id="scan-port" 
                            checked={portScanEnabled} 
                            onChange={e => setPortScanEnabled(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <Label htmlFor="scan-port" className="font-semibold">Port Scan</Label>
                    </div>
                    {portScanEnabled && (
                        <div className="ml-6 flex gap-4">
                            {['builtin', 'nmap'].map(tool => (
                                <label key={tool} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input 
                                        type="checkbox"
                                        checked={portScanTools.includes(tool)}
                                        onChange={e => {
                                            if (e.target.checked) {
                                                setPortScanTools([...portScanTools, tool]);
                                            } else {
                                                setPortScanTools(portScanTools.filter(t => t !== tool));
                                            }
                                        }}
                                        className="h-3 w-3 rounded border-gray-300"
                                    />
                                    {tool === 'builtin' ? 'Builtin' : 'Nmap'}
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <input 
                            type="checkbox" 
                            id="scan-fingerprint" 
                            checked={fingerprintEnabled} 
                            onChange={e => setFingerprintEnabled(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <Label htmlFor="scan-fingerprint" className="font-semibold">Fingerprint</Label>
                    </div>
                    {fingerprintEnabled && (
                        <div className="ml-6 flex gap-4">
                            {['builtin', 'httpx'].map(tool => (
                                <label key={tool} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input 
                                        type="checkbox"
                                        checked={fingerprintTools.includes(tool)}
                                        onChange={e => {
                                            if (e.target.checked) {
                                                setFingerprintTools([...fingerprintTools, tool]);
                                            } else {
                                                setFingerprintTools(fingerprintTools.filter(t => t !== tool));
                                            }
                                        }}
                                        className="h-3 w-3 rounded border-gray-300"
                                    />
                                    {tool === 'builtin' ? 'Builtin' : 'HTTPX'}
                                </label>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <input 
                            type="checkbox" 
                            id="scan-poc" 
                            checked={pocEnabled} 
                            onChange={e => setPocEnabled(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <Label htmlFor="scan-poc" className="font-semibold">POC Verify</Label>
                    </div>
                    {pocEnabled && (
                        <div className="ml-6 flex gap-4">
                            {['builtin', 'nuclei'].map(tool => (
                                <label key={tool} className="flex items-center gap-2 text-sm cursor-pointer">
                                    <input 
                                        type="checkbox"
                                        checked={pocTools.includes(tool)}
                                        onChange={e => {
                                            if (e.target.checked) {
                                                setPocTools([...pocTools, tool]);
                                            } else {
                                                setPocTools(pocTools.filter(t => t !== tool));
                                            }
                                        }}
                                        className="h-3 w-3 rounded border-gray-300"
                                    />
                                    {tool === 'builtin' ? 'Builtin' : 'Nuclei'}
                                </label>
                            ))}
                        </div>
                    )}
                </div>
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

        <DialogFooter>
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
