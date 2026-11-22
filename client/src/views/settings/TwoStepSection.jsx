import { FiCheckCircle } from 'react-icons/fi';
import { TwoStepMethods } from './TwoStepMethods.jsx';
import { SettingsPageHeader, Callout } from './SettingsKit.jsx';
import { Card, CardContent } from '@/components/ui/card';

// Two-step verification: authenticator app, email codes and WhatsApp codes,
// with a default method (TwoStepMethods, PR #45).
export const TwoStepSection = ({ me, onSaved }) => (
  <div className="max-w-3xl">
    <SettingsPageHeader section="two-step" />
    <Card>
      <CardContent className="flex flex-col gap-4">
        {me?.mfa_enabled ? (
          <Callout tone="ok"><FiCheckCircle className="mr-1 inline" /> Two-step verification is on. At sign-in you get a code from your default method and can switch to another one.</Callout>
        ) : (
          <Callout tone="warn">Two-step verification is off. Set up a method below so a stolen password alone cannot open your workspace.</Callout>
        )}
        <TwoStepMethods me={me} onChanged={onSaved} />
      </CardContent>
    </Card>
  </div>
);
