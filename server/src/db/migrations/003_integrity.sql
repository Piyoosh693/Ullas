-- Extra uniqueness guarantees for requests that must not be duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_pending_profile_once
  ON verification_requests(user_id)
  WHERE status='pending' AND request_type='profile';
CREATE UNIQUE INDEX IF NOT EXISTS idx_verification_pending_organization_once
  ON verification_requests(organization_id)
  WHERE status='pending' AND request_type='organization' AND organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_interest_offer_once
  ON interests(user_id, offer_id) WHERE offer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_interest_need_once
  ON interests(user_id, need_id) WHERE need_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_offer_once
  ON invitations(sender_user_id, recipient_user_id, offer_id)
  WHERE offer_id IS NOT NULL AND status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitation_need_once
  ON invitations(sender_user_id, recipient_user_id, need_id)
  WHERE need_id IS NOT NULL AND status='pending';
