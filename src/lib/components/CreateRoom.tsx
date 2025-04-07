import { useState } from "react";
import { Button } from "./ui/button";
import {
  Credenza,
  CredenzaBody,
  CredenzaClose,
  CredenzaContent,
  CredenzaFooter,
  CredenzaHeader,
  CredenzaTitle,
} from "./ui/credenza";
import { Input } from "./ui/input";

export function CreateRoom() {
  const [open, setOpen] = useState(false);

  const handleOpen = () => {
    setOpen(true);
  };

  return (
    <>
      <Button onClick={handleOpen}>Open with State</Button>

      <Credenza open={open} onOpenChange={setOpen}>
        <CredenzaContent className="bg-white border rounded-md shadow-xl flex flex-col justify-between p-4 dark:bg-gray-800">
          <CredenzaHeader>
            <CredenzaTitle>Create New Room</CredenzaTitle>
          </CredenzaHeader>
          <CredenzaBody>
            <div className="relative flex flex-col gap-2 bg-white dark:bg-gray-800 rounded-md">
              <Input
                className="peer pe-9 ps-9 dark:bg-gray-800"
                placeholder="Room name..."
                type="input"
              />
              <Input
                className="peer pe-9 ps-9 dark:bg-gray-800"
                placeholder="Room description..."
                type="input"
              />
            </div>
          </CredenzaBody>
          <CredenzaFooter>
            <CredenzaClose asChild>
              <Button>Create Room</Button>
            </CredenzaClose>
          </CredenzaFooter>
        </CredenzaContent>
      </Credenza>
    </>
  );
}
