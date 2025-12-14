import React, { useEffect, useRef, useState } from 'react';
import { useAddBackend } from '../hooks/use-scanner-api';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';
import { Shield, ShieldAlert } from 'lucide-react';

const validateAddress = (addr: string) => {
    const v = addr.trim();
    if (!v) return false;
    const hostPortPattern = /^(?:https?:\/\/)?[^\s/:]+(?::\d{1,5})?$/i;
    return hostPortPattern.test(v);
};

const NewBackendDialog: React.FC<{ open: boolean; onCancel: () => void }> = ({ open, onCancel }) => {
    const { mutateAsync: addBackend, isPending: isSubmitting, error: submitError } = useAddBackend();
    const navigate = useNavigate();

    const [name, setName] = useState('');
    const [ip, setIp] = useState('');
    const [port, setPort] = useState('');
    const [address, setAddress] = useState('');
    const [description, setDescription] = useState('');
    const [useTls, setUseTls] = useState(false);
    const [touched, setTouched] = useState({ name: false, address: false });
    const nameRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (open) {
            setName('');
            setIp('');
            setPort('');
            setAddress('');
            setDescription('');
            setUseTls(false);
            setTouched({ name: false, address: false });
            // Small delay to allow animation to start before focusing
            setTimeout(() => nameRef.current?.focus(), 100);
        }
    }, [open]);

    const nameError = touched.name && name.trim().length === 0 ? 'Name is required' : '';
    const addressError = touched.address && !(validateAddress(address) || (ip.trim() && /^\d{1,5}$/.test(port))) ? 'Address looks invalid' : '';

    const isValid = name.trim().length > 0 && (validateAddress(address) || (ip.trim().length > 0 && port.trim().length > 0));

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setTouched({ name: true, address: true });
        if (!isValid) return;
        
        let finalAddress = address.trim();
        if (!finalAddress) {
            const scheme = useTls ? 'https' : 'http';
            finalAddress = `${scheme}://${ip.trim()}:${port.trim()}`;
        }
        
        try {
            const res = await addBackend({ name: name.trim(), address: finalAddress, description: description.trim() || null, useTls });
            if (res?.id) navigate(`/server/${res.id}`);
            else navigate('/servers');
        } catch (e) {
            // handled by hook
        }
    };

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Add New Backend</DialogTitle>
                    <DialogDescription>
                        Connect to a new SuperScanner server instance.
                    </DialogDescription>
                </DialogHeader>
                
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name" className={nameError ? "text-destructive" : ""}>Name</Label>
                        <Input
                            id="name"
                            ref={nameRef}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onBlur={() => setTouched(t => ({ ...t, name: true }))}
                            placeholder="Production Server"
                            className={nameError ? "border-destructive focus-visible:ring-destructive" : ""}
                            disabled={isSubmitting}
                        />
                        {nameError && <span className="text-xs text-destructive">{nameError}</span>}
                    </div>

                    <div className="grid gap-2">
                        <Label>Connection Details</Label>
                        <div className="grid grid-cols-5 gap-2">
                            <Input
                                className="col-span-3"
                                value={ip}
                                onChange={e => setIp(e.target.value)}
                                placeholder="IP / Hostname"
                                disabled={isSubmitting}
                            />
                            <Input
                                className="col-span-2"
                                value={port}
                                onChange={e => setPort(e.target.value)}
                                placeholder="Port"
                                disabled={isSubmitting}
                            />
                        </div>
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-background px-2 text-muted-foreground">Or full URL</span>
                            </div>
                        </div>
                        <Input
                            value={address}
                            onChange={e => setAddress(e.target.value)}
                            placeholder="https://api.example.com:5000"
                            disabled={isSubmitting}
                            className={addressError ? "border-destructive focus-visible:ring-destructive" : ""}
                        />
                        {addressError && <span className="text-xs text-destructive">{addressError}</span>}
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="description">Description</Label>
                        <Input
                            id="description"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="Optional notes..."
                            disabled={isSubmitting}
                        />
                    </div>

                    <div className="flex items-center space-x-2 rounded-md border p-3 shadow-sm">
                        <input
                            type="checkbox"
                            id="tls"
                            checked={useTls}
                            onChange={e => setUseTls(e.target.checked)}
                            className="h-4 w-4 rounded border-primary text-primary focus:ring-primary"
                            disabled={isSubmitting}
                        />
                        <div className="flex-1 space-y-1">
                            <Label htmlFor="tls" className="cursor-pointer flex items-center gap-2">
                                {useTls ? <Shield size={14} className="text-green-500"/> : <ShieldAlert size={14} className="text-muted-foreground"/>}
                                Use TLS / SSL
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Enable if the server requires a secure connection (HTTPS/GRPCS).
                            </p>
                        </div>
                    </div>

                    {submitError && (
                        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                            {submitError.message}
                        </div>
                    )}
                </form>

                <DialogFooter>
                    <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
                        {isSubmitting ? 'Connecting...' : 'Add Backend'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NewBackendDialog;
