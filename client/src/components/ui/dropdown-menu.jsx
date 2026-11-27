import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { FiChevronRight } from 'react-icons/fi';
import { cn } from '@/lib/utils';

function DropdownMenu(props) {
  return <DropdownMenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger(props) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({ className, sideOffset = 4, ...props }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn('z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, variant = 'default', ...props }) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      className={cn(
        'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-red-50 [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }) {
  return <DropdownMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

function DropdownMenuLabel({ className, ...props }) {
  return <DropdownMenuPrimitive.Label className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...props} />;
}

function DropdownMenuSub(props) {
  return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({ className, children, ...props }) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="dropdown-menu-sub-trigger"
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      {...props}
    >
      {children}
      <FiChevronRight className="ml-auto text-muted-foreground" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({ className, ...props }) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        collisionPadding={8}
        className={cn('z-50 max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] min-w-[10rem] overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md', className)}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuLabel, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
};
