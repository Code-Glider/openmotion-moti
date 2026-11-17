import { editor0 } from "./editor/appearance.js";
import { editor4 } from "./editor/creation.js";
import { editor2 } from "./editor/links.js";
import { editor3 } from "./editor/playback.js";
import { editor1 } from "./editor/properties.js";
import { feedback2 } from "./feedback/animation.js";
import { feedback0 } from "./feedback/connection.js";
import { feedback3 } from "./feedback/context.js";
import { feedback1 } from "./feedback/exports.js";
import { feedback5 } from "./feedback/media.js";
import { feedback4 } from "./feedback/tasks.js";
import { validation } from "./feedback/validation.js";
import { library2 } from "./library/catalog.js";
import { library1 } from "./library/detail.js";
import { library4 } from "./library/navigation.js";
import { library3 } from "./library/preferences.js";
import { library5 } from "./library/sync.js";
import { library0 } from "./library/templates.js";
import { workspace1 } from "./workspace/controls.js";
import { workspace0 } from "./workspace/history.js";
export const catalog = {
  ...validation,
  ...recovery,
  ...feedback0,
  ...feedback1,
  ...feedback2,
  ...feedback3,
  ...feedback4,
  ...feedback5,
  ...editor0,
  ...editor1,
  ...editor2,
  ...editor3,
  ...editor4,
  ...library0,
  ...library1,
  ...library2,
  ...library3,
  ...library4,
  ...library5,
  ...workspace0,
  ...workspace1,
};

import { recovery } from "./feedback/recovery.js";
