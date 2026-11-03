import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../auth/use-auth';
import { SessionExpiredError } from '../../services/api-client';
import { useApi } from '../../services/use-api';
import { FormAlert, TextField } from '../form-controls';
import { Button } from '../ui/button';
import { Card, CardHeader } from '../ui/card';

/** Typed, so the permanent action cannot be confirmed by a stray click. */
export const ERASE_CONFIRMATION = 'DELETE';

/**
 * Deletes all of the user's documents and data, then signs out here. The
 * sign-in account itself is kept by the identity provider.
 */
export function EraseDataCard() {
  const api = useApi();
  const { client } = useAuth();
  const [confirmation, setConfirmation] = useState('');
  const [state, setState] = useState<'idle' | 'erasing' | 'failed'>('idle');

  async function erase() {
    if (confirmation !== ERASE_CONFIRMATION) return;
    setState('erasing');
    try {
      await api.delete('/me');
      await client.signOut({ scope: 'local' });
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) setState('failed');
    }
  }

  return (
    <Card className="border-red-200 p-5">
      <CardHeader
        title="Delete all my data"
        description="Permanently deletes every document, its file, extracted data and reviews, and your profile. Your sign-in account stays; signing in again starts empty. The activity history keeps entries without document content."
      />
      <form
        className="mt-4 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void erase();
        }}
      >
        <TextField
          label={`Type ${ERASE_CONFIRMATION} to confirm`}
          value={confirmation}
          autoComplete="off"
          onChange={(event) => {
            setConfirmation(event.target.value);
          }}
        />
        {state === 'failed' ? (
          <FormAlert tone="error">Could not delete your data. Try again.</FormAlert>
        ) : null}
        <Button
          type="submit"
          className="bg-red-600 hover:bg-red-700"
          disabled={confirmation !== ERASE_CONFIRMATION || state === 'erasing'}
        >
          <Trash2 aria-hidden="true" className="size-4" />
          {state === 'erasing' ? 'Deleting…' : 'Delete all my data'}
        </Button>
      </form>
    </Card>
  );
}
