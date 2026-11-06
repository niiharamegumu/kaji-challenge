import {
  deleteSharedPage,
  patchSharedPage,
  postSharedPage,
  postSharedPageLease,
  releaseSharedPageLease,
  renewSharedPageLease,
} from "../../../lib/api/operations";

// Keep the editor's effects behind the same API boundary as the other features.
export const sharedPagesApi = {
  create: postSharedPage,
  save: patchSharedPage,
  acquire: postSharedPageLease,
  renew: renewSharedPageLease,
  release: releaseSharedPageLease,
  remove: deleteSharedPage,
};
