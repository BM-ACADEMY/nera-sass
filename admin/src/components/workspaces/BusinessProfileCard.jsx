import React from 'react';
import { FiInfo, FiMapPin, FiMail, FiGlobe, FiTag, FiPlus, FiEdit2 } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// One line of business info, styled like WhatsApp's own business-info list.
const InfoRow = ({ icon: Icon, label, children, empty }) => (
  <div className="flex items-start gap-3 py-3">
    <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', empty ? 'bg-muted text-muted-foreground' : 'bg-green-50 text-green-700')}>
      <Icon className="size-4" />
    </span>
    <div className="min-w-0 flex-1">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className={cn('mt-0.5 text-sm break-words', empty && 'text-muted-foreground italic')}>{children}</div>
    </div>
  </div>
);

// The workspace's WhatsApp business profile as customers see it.
const BusinessProfileCard = ({ brand, whatsapp, connected, onEdit }) => {
  const name = whatsapp?.verified_name || brand?.name || 'Unnamed business';
  const category = brand?.wa_category && brand.wa_category !== 'OTHER' ? brand.wa_category : 'Other';
  const websites = [brand?.wa_website, brand?.wa_website_2].filter(Boolean);
  const items = [
    ['description', brand?.wa_description],
    ['address', brand?.wa_address],
    ['email', brand?.wa_email],
    ['website', websites.length ? websites : null],
  ];
  const filled = items.filter(([, v]) => v && (!Array.isArray(v) || v.length)).length;
  const nameMismatch = whatsapp?.verified_name && brand?.name && whatsapp.verified_name !== brand.name;

  return (
    <Card className="gap-0 overflow-hidden py-0">
      {/* Profile header */}
      <div className="relative bg-gradient-to-b from-green-50 to-card px-4 pt-5 pb-4 sm:px-6">
        <div className="absolute top-4 right-4 sm:right-6">
          <Button size="sm" onClick={onEdit}><FiEdit2 /> Edit profile</Button>
        </div>
        <div className="flex flex-col items-center gap-2 pt-6 text-center">
          <div className="relative">
            {whatsapp?.profile_picture_url
              ? <img src={whatsapp.profile_picture_url} alt="" className="size-20 rounded-full border-4 border-card object-cover shadow-sm" />
              : (
                <span className="flex size-20 items-center justify-center rounded-full border-4 border-card bg-green-100 text-2xl font-bold text-green-700 shadow-sm">
                  {name.charAt(0).toUpperCase()}
                </span>
              )}
            <span className="absolute -right-0.5 -bottom-0.5 flex size-7 items-center justify-center rounded-full border-2 border-card bg-[#25D366] text-white">
              <FaWhatsapp className="size-3.5" />
            </span>
          </div>
          <div className="min-w-0 max-w-full">
            <div className="truncate text-lg font-bold">{name}</div>
            <div className="text-xs text-muted-foreground">
              {whatsapp?.display_phone_number || (connected ? brand?.whatsapp_number : 'No WhatsApp number yet')}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Badge variant="muted"><FiTag /> {category}</Badge>
            <Badge variant={filled === items.length ? 'success' : 'warning'} className="tabular-nums">Profile {filled}/{items.length} complete</Badge>
          </div>
          {nameMismatch && (
            <p className="max-w-sm text-[11px] text-amber-700">
              WhatsApp shows "{whatsapp.verified_name}", not "{brand.name}". The display name belongs to the number; give this workspace a number with its own name.
            </p>
          )}
        </div>
      </div>

      {/* Business info */}
      <div className="px-4 pb-4 sm:px-6">
        {filled === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <div className="text-sm font-semibold">No business info yet</div>
            <p className="max-w-xs text-xs text-muted-foreground">Add a description, address, email and website so customers know who they are chatting with.</p>
            <Button size="sm" variant="outline" onClick={onEdit}><FiPlus /> Add business info</Button>
          </div>
        ) : (
          <div className="divide-y divide-border">
            <InfoRow icon={FiInfo} label="Description" empty={!brand?.wa_description}>{brand?.wa_description || 'No description'}</InfoRow>
            <InfoRow icon={FiMapPin} label="Address" empty={!brand?.wa_address}>{brand?.wa_address || 'No address'}</InfoRow>
            <InfoRow icon={FiMail} label="Email" empty={!brand?.wa_email}>
              {brand?.wa_email ? <a href={`mailto:${brand.wa_email}`} className="text-primary hover:underline">{brand.wa_email}</a> : 'No email'}
            </InfoRow>
            <InfoRow icon={FiGlobe} label={websites.length > 1 ? 'Websites' : 'Website'} empty={!websites.length}>
              {websites.length
                ? websites.map((w) => <a key={w} href={w} target="_blank" rel="noreferrer" className="block truncate text-primary hover:underline">{w.replace(/^https?:\/\//, '')}</a>)
                : 'No website'}
            </InfoRow>
          </div>
        )}
        {!connected && (
          <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Saved in Getnera. It appears on WhatsApp once a number is connected and the profile is saved again.
          </div>
        )}
      </div>
    </Card>
  );
};

export default BusinessProfileCard;
