// src/components/CompleteWithDateMenu.tsx
// A plain tap completes a care item for "now" — zero extra friction for the
// common case. The small chevron next to it opens a short menu for logging
// a task done on one of the last few days instead (forgot to mark
// yesterday's watering, etc.) — capped at 3 days ago, not a full date
// picker, to keep the control simple.

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';

const DAYS_AGO_OPTIONS = [0, 1, 2, 3];

function dateDaysAgo(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

interface CompleteWithDateMenuProps {
  onComplete: (when: Date) => void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Applied to the whole control (background, rounding, text color) — the
   *  main tap target and the date-chevron render inside it, transparent. */
  wrapperClassName: string;
  mainButtonClassName?: string;
}

export function CompleteWithDateMenu({
  onComplete,
  disabled,
  children,
  wrapperClassName,
  mainButtonClassName,
}: CompleteWithDateMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  const dayLabel = (daysAgo: number) => {
    if (daysAgo === 0) return t('completeWithDate.today');
    if (daysAgo === 1) return t('completeWithDate.yesterday');
    return t('completeWithDate.daysAgo', { count: daysAgo });
  };

  return (
    <div ref={ref} className={`relative inline-flex items-stretch ${wrapperClassName}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onComplete(new Date())}
        className={mainButtonClassName}
      >
        {children}
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-label={t('completeWithDate.chooseDate')}
        className="flex items-center border-l border-white/30 px-1 disabled:opacity-60"
      >
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {DAYS_AGO_OPTIONS.map((daysAgo) => (
            <button
              key={daysAgo}
              type="button"
              onClick={() => {
                onComplete(dateDaysAgo(daysAgo));
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
            >
              {dayLabel(daysAgo)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
