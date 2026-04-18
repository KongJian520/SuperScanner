import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    const { t } = useTranslation();
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

    const nameError = touched.name && name.trim().length === 0 ? t('new_backend.name_required') : '';
    const addressError = touched.address && !(validateAddress(address) || (ip.trim() && /^\d{1,5}$/.test(port))) ? t('new_backend.address_invalid') : '';

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
            <DialogContent className="sm:max-w-[425px] border-border/60 bg-background/95 supports-[backdrop-filter]:bg-background/85 backdrop-blur-sm data-[state=open]:duration-300 data-[state=closed]:duration-200 data-[state=open]:slide-in-from-top-2 data-[state=closed]:slide-out-to-top-2">
                <DialogHeader className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:[animation-delay:40ms] motion-safe:[animation-fill-mode:both]">
                    <DialogTitle>{t('new_backend.title')}</DialogTitle>
                    <DialogDescription>
                        {t('new_backend.description')}
                    </DialogDescription>
                </DialogHeader>
                
                <form onSubmit={handleSubmit} className="grid gap-4 py-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:[animation-delay:110ms] motion-safe:[animation-fill-mode:both]">
                    <div className="grid gap-2">
                        <Label htmlFor="name" className={nameError ? "text-destructive" : ""}>{t('new_backend.name_label')}</Label>
                        <Input
                            id="name"
                            ref={nameRef}
                            value={name}
                            onChange={e => setName(e.target.value)}
                            onBlur={() => setTouched(t => ({ ...t, name: true }))}
                            placeholder={t('new_backend.name_placeholder')}
                            className={nameError ? "border-destructive focus-visible:ring-destructive" : ""}
                            disabled={isSubmitting}
                        />
                        <div
                            className={`grid transition-all duration-200 ease-out ${nameError ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                            aria-live="polite"
                        >
                            <span className="overflow-hidden text-xs text-destructive">{nameError || "\u00A0"}</span>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label>{t('new_backend.connection_details')}</Label>
                        <div className="grid grid-cols-5 gap-2">
                            <Input
                                className="col-span-3"
                                value={ip}
                                onChange={e => setIp(e.target.value)}
                                placeholder={t('new_backend.ip_placeholder')}
                                disabled={isSubmitting}
                            />
                            <Input
                                className="col-span-2"
                                value={port}
                                onChange={e => setPort(e.target.value)}
                                placeholder={t('new_backend.port_placeholder')}
                                disabled={isSubmitting}
                            />
                        </div>
                        <div className="relative">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-background px-2 text-muted-foreground">{t('new_backend.or_full_url')}</span>
                            </div>
                        </div>
                        <Input
                            value={address}
                            onChange={e => setAddress(e.target.value)}
                            placeholder={t('new_backend.url_placeholder')}
                            disabled={isSubmitting}
                            className={addressError ? "border-destructive focus-visible:ring-destructive" : ""}
                        />
                        <div
                            className={`grid transition-all duration-200 ease-out ${addressError ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                            aria-live="polite"
                        >
                            <span className="overflow-hidden text-xs text-destructive">{addressError || "\u00A0"}</span>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="description">{t('new_backend.desc_label')}</Label>
                        <Input
                            id="description"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder={t('new_backend.desc_placeholder')}
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
                                {t('new_backend.use_tls')}
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                {t('new_backend.tls_help')}
                            </p>
                        </div>
                    </div>

                    <div
                        className={`grid transition-all duration-200 ease-out ${submitError ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
                        aria-live="polite"
                    >
                        <div className="overflow-hidden">
                            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200">
                                {submitError?.message}
                            </div>
                        </div>
                    </div>
                </form>

                <DialogFooter className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:[animation-delay:180ms] motion-safe:[animation-fill-mode:both]">
                    <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
                        {t('new_backend.cancel')}
                    </Button>
                    <Button onClick={handleSubmit} disabled={!isValid || isSubmitting}>
                        {isSubmitting ? t('new_backend.connecting') : t('new_backend.add_backend')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default NewBackendDialog;
