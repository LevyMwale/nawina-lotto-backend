-- Update all existing open draws to K2 ticket price
UPDATE hourly_draws SET ticket_price = 2 WHERE status = 'open';
