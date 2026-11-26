import { TwoStepMethods } from './TwoStepMethods.jsx';
import { SettingsPageHeader } from './SettingsKit.jsx';
import { Card, CardContent } from '@/components/ui/card';

// Two-step verification: the on/off switch and the methods (authenticator app,
// email codes, WhatsApp codes), with a default method (TwoStepMethods).
export const TwoStepSection = ({ me, onSaved }) => (
  <div className="max-w-3xl">
    <SettingsPageHeader section="two-step" />
    <Card>
      <CardContent>
        <TwoStepMethods me={me} onChanged={onSaved} />
      </CardContent>
    </Card>
  </div>
);
