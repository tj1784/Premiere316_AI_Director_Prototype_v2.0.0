import { useRef, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CabinetModal({
  title,
  children,
  open,
  onOpenChange,
  trigger,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="cabinet-overlay" />
        <Dialog.Content
          className="cabinet-modal"
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (!trigger && opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus();
            }
          }}
        >
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Close ${title}`}>
                <X size={18} />
              </Button>
            </Dialog.Close>
          </header>
          <div className="cabinet-modal-content">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function CabinetTabs({
  items,
  label,
  initial,
}: {
  items: { id: string; label: string; content: ReactNode }[];
  label: string;
  initial?: string;
}) {
  return (
    <Tabs.Root className="cabinet-tabs-root" defaultValue={initial ?? items[0]?.id}>
      <Tabs.List className="cabinet-tabs" aria-label={label}>
        {items.map((item) => (
          <Tabs.Trigger key={item.id} value={item.id}>
            {item.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {items.map((item) => (
        <Tabs.Content className="cabinet-tab-body" key={item.id} value={item.id}>
          {item.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}
export function CabinetCarousel({
  items,
  label,
  pageSize = 4,
}: {
  items: ReactNode[];
  label: string;
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages - 1);
  return (
    <section className="cabinet-carousel" aria-label={label} aria-roledescription="carousel">
      <header>
        <span>
          {label} <small>{items.length}</small>
        </span>
        <div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Previous ${label}`}
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={16} />
          </Button>
          <span aria-live="polite">
            {current + 1} / {pages}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Next ${label}`}
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </header>
      <div className="cabinet-carousel-cards">
        {items.slice(current * pageSize, (current + 1) * pageSize)}
      </div>
      {!items.length && <p className="cabinet-empty">No matching records.</p>}
    </section>
  );
}
