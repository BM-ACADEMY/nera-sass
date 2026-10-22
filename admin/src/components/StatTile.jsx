import React from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Label + big number tile used by the workflow and founder report views.
const StatTile = ({ label, value, icon, valueClassName }) => (
  <Card className="gap-2 px-5 py-4">
    <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
    <div className={cn('flex items-center gap-2 text-2xl font-extrabold tabular-nums', valueClassName)}>
      {icon && <span className="text-xl">{icon}</span>}
      {value}
    </div>
  </Card>
);

export default StatTile;
