import React, {useCallback, useEffect, useRef, useState} from 'react';
import {AnimatePresence, motion} from 'framer-motion';

type NewBackendPayload = {
    name: string;
    address: string;
    description?: string | null;
    useTls: boolean;
};

type Props = {
    open: boolean;
    onSubmit: (payload: NewBackendPayload) => void;
    onCancel: () => void;
    isSubmitting?: boolean;
    error?: string | null;
};

const validateAddress = (addr: string) => {
    const v = addr.trim();
    if (!v) return false;
    const hostPortPattern = /^(?:https?:\/\/)?[^\s/:]+(?::\d{1,5})?$/i;
    return hostPortPattern.test(v);
};

const NewBackendDialog: React.FC<Props> = ({ open, onSubmit, onCancel, isSubmitting: propsIsSubmitting, error: propsError }) => {
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
            // focus name input when opening
            setTimeout(() => nameRef.current?.focus(), 0);
        }
    }, [open]);

    const nameError = touched.name && name.trim().length === 0 ? 'Name is required' : '';
    const addressError = touched.address && !(validateAddress(address) || (ip.trim() && /^\\d{1,5}$/.test(port))) ? 'Address looks invalid' : '';

    const isValid = name.trim().length > 0 && (validateAddress(address) || (ip.trim().length > 0 && port.trim().length > 0));

    const handleSubmit = useCallback((e?: React.FormEvent) => {
        e?.preventDefault();
        setTouched({ name: true, address: true });
        if (!isValid) return;
        // Build address: prefer explicit address field if present, otherwise construct from ip/port
        let finalAddress = address.trim();
        if (!finalAddress) {
            const scheme = useTls ? 'https' : 'http';
            finalAddress = `${scheme}://${ip.trim()}:${port.trim()}`;
        }
        onSubmit({ name: name.trim(), address: finalAddress, description: description.trim() || null, useTls: useTls });
    }, [name, address, useTls, isValid, onSubmit]);

    // keyboard handling: ESC to close, Enter to submit
    useEffect(() => {
        const onKey = (ev: KeyboardEvent) => {
            if (!open) return;
            if (ev.key === 'Escape') {
                ev.preventDefault();
                onCancel();
            }
            if (ev.key === 'Enter') {
                const active = document.activeElement;
                // avoid submitting when focus is on a button that already handles click
                if (active instanceof HTMLInputElement || active instanceof HTMLButtonElement) {
                    ev.preventDefault();
                    handleSubmit();
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, handleSubmit, onCancel]);

    return (
        <AnimatePresence>
            {open && (
                <motion.div className="fixed inset-0 z-50 flex items-center justify-center"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                >
                    <motion.div
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={onCancel}
                        aria-hidden
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    />

                    <motion.form
                        onSubmit={handleSubmit}
                        className="relative z-10 w-full max-w-md bg-card rounded-lg shadow-lg p-6 ring-1 ring-black/10"
                        role="dialog"
                        aria-modal="true"
                        initial={{ y: 16, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 8, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                        <h3 className="text-lg font-semibold mb-4">Add New Backend</h3>

                        <label className="block mb-3">
                            <span className="text-sm text-muted-foreground">Name</span>
                            <input
                                ref={nameRef}
                                className={`mt-1 block w-full rounded-md border px-3 py-2 bg-input text-sm ${nameError ? 'border-red-500' : 'border-border'
                                    }`}
                                value={name}
                                onChange={e => setName(e.target.value)}
                                onBlur={() => setTouched(t => ({ ...t, name: true }))}
                                disabled={propsIsSubmitting}
                            />
                            {nameError && <span className="text-xs text-red-400 mt-1 block">{nameError}</span>}
                        </label>

                        <label className="block mb-3">

                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <input
                                    className="mt-1 block w-full rounded-md border px-3 py-2 bg-input text-sm border-border"
                                    value={ip}
                                    onChange={e => setIp(e.target.value)}
                                    placeholder="IP or hostname"
                                    disabled={propsIsSubmitting}
                                />
                                <input
                                    className="mt-1 block w-full rounded-md border px-3 py-2 bg-input text-sm border-border"
                                    value={port}
                                    onChange={e => setPort(e.target.value)}
                                    placeholder="Port (e.g., 50051)"
                                    disabled={propsIsSubmitting}
                                />
                            </div>
                            {addressError && <span className="text-xs text-red-400 mt-1 block">{addressError}</span>}
                        </label>

                        <label className="block mb-3">
                            <span className="text-sm text-muted-foreground">Description (optional)</span>
                            <input
                                className={`mt-1 block w-full rounded-md border px-3 py-2 bg-input text-sm border-border`}
                                value={description}
                                onChange={e => setDescription(e.target.value)}
                                disabled={propsIsSubmitting}
                            />
                        </label>

                        <label className="flex items-center gap-2 mb-4">
                            <input
                                type="checkbox"
                                checked={useTls}
                                onChange={e => setUseTls(e.target.checked)}
                                className="w-4 h-4 rounded border-border bg-input"
                                disabled={propsIsSubmitting}
                            />
                            <span className="text-sm text-muted-foreground">Use TLS</span>
                        </label>

                        <div className="flex justify-end gap-2 mt-2">
                            <button
                                type="button"
                                onClick={onCancel}
                                className="px-3 py-2 rounded-md bg-transparent text-sm text-muted-foreground hover:bg-muted/10"
                                disabled={propsIsSubmitting}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                onClick={e => { e.preventDefault(); handleSubmit(); }}
                                disabled={!isValid || propsIsSubmitting}
                                className={`px-3 py-2 rounded-md text-sm text-white ${isValid ? 'bg-primary hover:bg-primary/90' : 'bg-primary/50 cursor-not-allowed'
                                    }`}
                            >
                                {propsIsSubmitting ? 'Adding...' : 'Add Backend'}
                            </button>
                        </div>
                        {propsError && (
                            <div className="mt-3 text-sm text-red-400">{propsError}</div>
                        )}
                    </motion.form>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default NewBackendDialog;
