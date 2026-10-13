import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useKeyboard } from '@/contexts/KeyboardContext';
import { useChanges } from '@/contexts/ChangesContext';
import { fileService } from '@/services/file.service';
import { prepareImport, type ImportReview } from '@/services/import-preflight';
import type { KeyboardInfo } from '@/types/keyboard.types';

export function useLayoutImport() {
    const { keyboard, setKeyboard, isConnected, setIsImporting, loadFromFile } = useKeyboard();
    const { queue, todo, isInstant, commit, isSaving } = useChanges();
    const [review, setReview] = useState<{ plan: ImportReview; target: KeyboardInfo | null; connected: boolean; filename: string; file: File } | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);
    const [applying, setApplying] = useState(false);

    const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        await reviewFile(file);
    };

    /** Open the import review for a layout file (also used to restore backups). */
    const reviewFile = async (file: File) => {
        setFileError(null);
        if (Object.keys(todo).length || isSaving) {
            setFileError('Apply or discard your pending changes before importing a layout.');
            return;
        }
        setIsImporting(true);
        try {
            const imported = await fileService.uploadFile(file);
            setReview({ plan: prepareImport(imported, isConnected && keyboard ? keyboard : undefined), target: keyboard, connected: isConnected, filename: file.name, file });
        } catch (error) {
            setFileError(error instanceof Error ? error.message : String(error));
        } finally { setIsImporting(false); }
    };

    const applyImport = async () => {
        if (!review || review.plan.errors.length) return;
        if (review.target !== keyboard || review.connected !== isConnected || Object.keys(todo).length || isSaving) {
            setFileError('The editing target or pending changes changed. Close this review and select the file again.');
            return;
        }
        setApplying(true);
        setFileError(null);
        try {
            const next = review.plan.keyboard;
            if (!isConnected) {
                if (await loadFromFile(review.file) === false) return;
            } else if (keyboard) {
                setKeyboard(next);
                const { importService } = await import('@/services/import.service');
                const { keyboardService } = await import('@/services/keyboard.service');
                await importService.syncWithKeyboard(next, keyboard, (desc, cb, metadata) => queue(desc, cb, { ...metadata, deferCommit: true }), { keyboardService });
                if (isInstant && !await commit()) throw new Error('Some imported changes could not be saved. They remain in pending changes. Retry Apply after restoring the connection.');
            }
            setReview(null);
        } catch (error) {
            setFileError(error instanceof Error ? error.message : String(error));
            setReview(null);
        } finally { setApplying(false); }
    };

    const importReview = <>
        {fileError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{fileError}</p>}
        <Dialog open={!!review} onOpenChange={open => { if (!open && !applying) setReview(null); }}>
            <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
                <DialogHeader>
                    <DialogTitle>Review layout import</DialogTitle>
                    <DialogDescription>{review?.filename} — {isConnected ? `replace matching entries on ${keyboard?.name || 'the connected keyboard'}` : 'open as an offline layout'}.</DialogDescription>
                </DialogHeader>
                <ul className="list-disc pl-5 text-sm space-y-1">{review?.plan.summary.map((line, i) => <li key={i}>{line}</li>)}</ul>
                {!!review?.plan.errors.length && <div role="alert" className="text-sm text-red-700 dark:text-red-400"><p className="font-semibold">Cannot import this file</p><ul className="list-disc pl-5">{review.plan.errors.map((line, i) => <li key={i}>{line}</li>)}</ul></div>}
                {!!review?.plan.warnings.length && <div className="text-sm"><p className="font-semibold">Review before applying</p><ul className="list-disc pl-5">{review.plan.warnings.map((line, i) => <li key={i}>{line}</li>)}</ul></div>}
                {fileError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{fileError}</p>}
                <p className="text-sm">{isConnected ? (isInstant ? 'Applying writes these changes to the keyboard. Save a backup first so you can restore the previous layout.' : 'This will stage changes in Manual mode. Nothing is written until you use Apply.') : 'This replaces the current offline layout.'}</p>
                <DialogFooter className="flex-wrap">
                    {keyboard && <Button variant="secondary" disabled={applying} onClick={async () => { try { await fileService.downloadSvil(keyboard); } catch (error) { setFileError(error instanceof Error ? error.message : String(error)); } }}>Back up current layout</Button>}
                    <Button variant="secondary" disabled={applying} onClick={() => setReview(null)}>Cancel</Button>
                    <Button disabled={applying || !!review?.plan.errors.length} onClick={applyImport}>{applying ? 'Applying…' : isConnected ? (isInstant ? 'Apply import' : 'Stage import') : 'Open layout'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    </>;

    return { handleFileImport, reviewFile, importReview, fileError, setFileError };
}
