-- Sample catalog & opening stock (illustrative prices, ex-GST, per bag). Replace with live price list.
insert into public.products (sku, name, category, hsn_code, unit, pack_size_kg, price, gst_rate) values
  ('UREA-45',      'Neem Coated Urea 46% N',         'Straight N',  '3102', 'BAG', 45,  266.50, 5),
  ('DAP-50',       'DAP 18:46:0',                    'Phosphatic',  '3105', 'BAG', 50, 1350.00, 5),
  ('NPK-102626',   'NPK 10:26:26',                   'Complex',     '3105', 'BAG', 50, 1470.00, 5),
  ('NPK-121232',   'NPK 12:32:16',                   'Complex',     '3105', 'BAG', 50, 1450.00, 5),
  ('MOP-50',       'Muriate of Potash 60% K2O',      'Potassic',    '3104', 'BAG', 50, 1700.00, 5),
  ('SSP-50',       'Single Super Phosphate 16% P2O5','Phosphatic',  '3103', 'BAG', 50,  480.00, 5),
  ('ZNSO4-10',     'Zinc Sulphate Monohydrate 33%',  'Micronutrient','2833','BAG', 10,  720.00, 12),
  ('WSF-191919',   'Water Soluble NPK 19:19:19',     'Specialty',   '3105', 'BAG', 25, 2650.00, 5)
on conflict (sku) do nothing;

insert into public.inventory (godown_id, product_id, stock_qty)
select g.id, p.id,
       case g.id when 'MH_GODOWN' then 1200 else 600 end
from public.godowns g cross join public.products p
on conflict do nothing;
