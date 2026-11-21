import { useState } from 'react';
import { FiCheckCircle, FiShield } from 'react-icons/fi';
import { MfaEnrollment } from './MfaEnrollment.jsx';
import { SettingsPageHeader, Callout } from './SettingsKit.jsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

// Two-step verification through the existing auth endpoints (start, then
// confirm with a code from the authenticator app).
export const TwoStepSection = ({ me, onSaved }) => {
  const [enrolling, setEnrolling] = useState(false);

  return (
    <div className="max-w-3xl">
      <SettingsPageHeader section="two-step" />
      <Card>
        <CardContent className="flex flex-col gap-4">
          {me?.mfa_enabled ? (
            <Callout tone="ok"><FiCheckCircle className="mr-1 inline" /> Two-step verification is on. You will be asked for a code when you sign in.</Callout>
          ) : enrolling ? (
            <MfaEnrollment onDone={() => { setEnrolling(false); onSaved?.(); }} onCancel={() => setEnrolling(false)} />
          ) : (
            <>
              <Callout tone="warn">Two-step verification is off. Turn it on so a stolen password alone cannot open your workspace.</Callout>
              <div><Button onClick={() => setEnrolling(true)}><FiShield /> Turn on two-step verification</Button></div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
