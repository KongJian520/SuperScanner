import React, { useState } from 'react';
import { useBackends, useCreateTask } from '../hooks/use-scanner-api';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Server, Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export const CreateTaskDialog: React.FC = () => {
  const navigate = useNavigate();
  const { data: availableBackends = [] } = useBackends();
  const { mutateAsync: createTask, isPending: isSubmitting } = useCreateTask();
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetString, setTargetString] = useState('');
  const [selectedBackendId, setSelectedBackendId] = useState<string | null>(null);

  const handleCancel = () => navigate('/tasks');

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!targetString) return;
    const targets = targetString.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
    if (targets.length === 0) return;
    
    if (!selectedBackendId) {
        toast.error('Please select a backend engine');
        return;
    }

    try {
      const res = await createTask({
        name: name || `Scan ${targets[0]}`,
        description,
        targets,
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
          <DialogTitle>Create New Scan Task</DialogTitle>
          <DialogDescription>
            Configure the target and select a backend engine to perform the scan.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
            {/* Targets */}
            <div className="grid gap-2">
                <Label htmlFor="targets" className="text-base">Targets</Label>
                <Input
                    id="targets"
                    value={targetString}
                    onChange={(e) => setTargetString(e.target.value)}
                    placeholder="192.168.1.1, example.com"
                    className="font-mono"
                    autoFocus
                    disabled={isSubmitting}
                />
                <p className="text-xs text-muted-foreground">
                    Enter IP addresses or hostnames, separated by commas.
                </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="name">Task Name</Label>
                    <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Optional name"
                        disabled={isSubmitting}
                    />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="desc">Description</Label>
                    <Input
                        id="desc"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Optional description"
                        disabled={isSubmitting}
                    />
                </div>
            </div>

            {/* Backend Selection */}
            <div className="grid gap-2">
                <Label>Select Backend Engine</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[200px] overflow-y-auto pr-1">
                    {availableBackends.length === 0 && (
                        <div className="col-span-2 p-4 border border-dashed rounded-md text-center text-sm text-muted-foreground">
                            No backends available. Please add a server first.
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
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!targetString || !selectedBackendId || isSubmitting}>
            {isSubmitting ? 'Creating...' : 'Start Scan'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTaskDialog;
