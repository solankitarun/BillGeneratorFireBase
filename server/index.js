const express = require('express');
const cors = require('cors');
const { db, connectDB } = require('./db');
const fs = require('fs');
const path = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
require('dotenv').config();
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim().replace(/\/$/, '')) 
    : ['http://localhost:5000', 'http://localhost:5001', 'http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        
        const normalizedOrigin = origin.replace(/\/$/, '');
        if (allowedOrigins.indexOf(normalizedOrigin) === -1) {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
            return callback(new Error(msg), false);
        }
        return callback(null, true);
    },
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Serve static files from uploads folder
app.use('/uploads', express.static(uploadDir));

// --- HELPERS ---
const safeDate = (dt) => {
    if (!dt) return null;
    if (typeof dt.toDate === 'function') return dt.toDate().toISOString();
    if (dt instanceof Date) return dt.toISOString();
    return new Date(dt).toISOString();
};

// --- WHATSAPP INITIALIZATION ---
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('SCAN THIS QR CODE FOR WHATSAPP LOGIN:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('WhatsApp Client is ready!');
});

client.on('auth_failure', msg => {
    console.error('WhatsApp Auth failure', msg);
});

client.initialize();

// Connect to Database
connectDB();

// --- ROUTES ---

// 0. Root Route (Health Check)
app.get('/', (req, res) => {
    res.send(`
        <div style="font-family: sans-serif; text-align: center; padding-top: 50px;">
            <h1 style="color: #4CAF50;">✅ Server is Connected</h1>
            <p>Laundry Bill Generator API is running successfully.</p>
            <p>Local Time: ${new Date().toLocaleString()}</p>
        </div>
    `);
});

// 1. Get Shop Details
app.get('/api/shop', async (req, res) => {
    try {
        const shopSnapshot = await db.collection('ShopMaster').limit(1).get();
        if (shopSnapshot.empty) {
            return res.json({});
        }
        res.json({ id: shopSnapshot.docs[0].id, ...shopSnapshot.docs[0].data() });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 1.1 Update Shop Details
app.post('/api/shop', async (req, res) => {
    const { ShopName, Tagline, Address, Phone, TaxRate } = req.body;
    try {
        const shopSnapshot = await db.collection('ShopMaster').limit(1).get();
        const shopData = { ShopName, Tagline, Address, Phone, TaxRate: parseFloat(TaxRate) };

        if (shopSnapshot.empty) {
            await db.collection('ShopMaster').add(shopData);
        } else {
            await db.collection('ShopMaster').doc(shopSnapshot.docs[0].id).update(shopData);
        }
        res.json({ message: 'Shop details updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating shop details');
    }
});

// 2. Get Laundry Items
app.get('/api/items', async (req, res) => {
    try {
        const snapshot = await db.collection('LaundryItemMaster').where('IsActive', '==', 1).get();
        const items = snapshot.docs.map(doc => ({
            ItemID: doc.id,
            ItemName: doc.data().ItemName,
            UnitPrice: doc.data().DefaultPrice,
            IsActive: doc.data().IsActive
        }));
        res.json(items);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 2.1 Add Laundry Item
app.post('/api/items', async (req, res) => {
    const { ItemName, UnitPrice } = req.body;
    try {
        await db.collection('LaundryItemMaster').add({
            ItemName,
            DefaultPrice: parseFloat(UnitPrice),
            IsActive: 1
        });
        res.status(201).json({ message: 'Item added successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error adding item');
    }
});

// 2.2 Update Laundry Item
app.put('/api/items/:id', async (req, res) => {
    const { id } = req.params;
    const { ItemName, UnitPrice } = req.body;
    try {
        await db.collection('LaundryItemMaster').doc(id).update({
            ItemName,
            DefaultPrice: parseFloat(UnitPrice)
        });
        res.json({ message: 'Item updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating item');
    }
});

// 2.3 Delete Laundry Item (Soft Delete)
app.delete('/api/items/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('LaundryItemMaster').doc(id).update({ IsActive: 0 });
        res.json({ message: 'Item deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting item');
    }
});

// 3. Save or Update Bill
app.post('/api/bills', async (req, res) => {
    const { billId, customerName, customerPhone, customerTown, returnDate, items, subtotal, tax, grandTotal, invoiceNum } = req.body;

    try {
        const billData = {
            InvoiceNumber: invoiceNum,
            CustomerName: customerName,
            CustomerPhone: customerPhone,
            CustomerTown: customerTown,
            ReturnDate: returnDate ? new Date(returnDate) : null,
            SubTotal: parseFloat(subtotal),
            TaxAmount: parseFloat(tax),
            GrandTotal: parseFloat(grandTotal),
            BillDate: new Date(),
            PaymentStatus: 'Pending',
            items: items.map(item => ({
                ItemName: item.name,
                Quantity: parseInt(item.qty),
                UnitPrice: parseFloat(item.price),
                TotalPrice: parseFloat(item.total)
            }))
        };

        if (billId) {
            // Update existing bill
            await db.collection('Bills').doc(billId).update(billData);
            res.json({ message: 'Bill updated successfully', billId });
        } else {
            // Create new bill
            const docRef = await db.collection('Bills').add(billData);
            res.status(201).json({ message: 'Bill saved successfully', billId: docRef.id });
        }

    } catch (err) {
        console.error(err);
        res.status(500).send('Error saving bill');
    }
});

// 3.1 Delete Bill
app.delete('/api/bills/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('Bills').doc(id).delete();
        res.json({ message: 'Bill deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error deleting bill');
    }
});

// 4. Mark Bill as Paid
app.put('/api/bills/:id/pay', async (req, res) => {
    const { id } = req.params;
    try {
        await db.collection('Bills').doc(id).update({ PaymentStatus: 'Paid' });
        res.json({ message: 'Bill marked as paid' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error updating payment status');
    }
});

// 4.1 Get Pending Bills
app.get('/api/bills/pending', async (req, res) => {
    try {
        const snapshot = await db.collection('Bills').get();
        const bills = snapshot.docs
            .map(doc => {
                const data = doc.data();
                return {
                    BillID: doc.id,
                    ...data,
                    BillDate: safeDate(data.BillDate),
                    ReturnDate: safeDate(data.ReturnDate)
                };
            })
            .filter(bill => !bill.PaymentStatus || bill.PaymentStatus === 'Pending')
            .sort((a, b) => new Date(b.BillDate) - new Date(a.BillDate));

        res.json(bills);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching pending bills');
    }
});

// 4.2 Get Bill Items (Detail View)
app.get('/api/bills/:id/items', async (req, res) => {
    const { id } = req.params;
    try {
        const doc = await db.collection('Bills').doc(id).get();
        if (!doc.exists) return res.status(404).send('Bill not found');
        res.json(doc.data().items || []);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching bill items');
    }
});

// 5. Upload PDF
app.post('/api/upload-pdf', async (req, res) => {
    try {
        const { pdfData, fileName, customerName, customerPhone, shopName, items, billDetails, isEdited } = req.body;
        if (!pdfData) return res.status(400).send('No PDF data provided');

        let finalFileName = fileName || `Bill_${Date.now()}.pdf`;

        // Append _Edited if it's an edited bill and not already present
        if (isEdited && !finalFileName.includes('_Edited')) {
            finalFileName = finalFileName.replace('.pdf', '_Edited.pdf');
        }

        const base64Data = pdfData.replace(/^data:application\/pdf;base64,/, "");

        // 1. Save to local uploads folder
        const localPath = path.join(uploadDir, finalFileName);
        fs.writeFileSync(localPath, base64Data, 'base64');

        // 2. Save to PDF_EXPORT_PATH if provided
        const exportRoot = process.env.PDF_EXPORT_PATH;
        if (exportRoot) {
            const now = new Date();
            const year = now.getFullYear().toString();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const day = now.getDate().toString().padStart(2, '0');

            const archiveDir = path.join(exportRoot, year, month, day);
            if (!fs.existsSync(archiveDir)) {
                fs.mkdirSync(archiveDir, { recursive: true });
            }
            const archivePath = path.join(archiveDir, finalFileName);
            fs.writeFileSync(archivePath, base64Data, 'base64');
            console.log(`PDF Archived to: ${archivePath}`);
        }

        // 3. Send WhatsApp Message
        if (client.info && customerPhone) {
            try {
                const formattedPhone = (process.env.WHATSAPP_COUNTRY_CODE || '91') + customerPhone.replace(/\D/g, '');
                const chatId = `${formattedPhone}@c.us`;

                let message = `*${shopName || 'FreshWash'} Invoice*\n\n`;
                message += `Hello *${customerName}*,\nYour bill is ready.\n\n`;
                message += `*Bill No:* ${billDetails?.invoiceNum || 'N/A'}\n`;
                message += `*Total Amount:* ₹${billDetails?.grandTotal || '0'}\n`;
                message += `*Return Date:* ${billDetails?.returnDate ? new Date(billDetails.returnDate).toLocaleDateString() : 'N/A'}\n\n`;

                if (items && items.length > 0) {
                    message += `*Items:*\n`;
                    items.forEach(item => {
                        message += `- ${item.name || item.ItemName} (x${item.qty || item.Quantity}): ₹${item.total || item.TotalPrice}\n`;
                    });
                    message += `\n`;
                }

                message += `Thank you for choosing us!`;

                await client.sendMessage(chatId, message);
                console.log(`WhatsApp message sent to ${formattedPhone}`);
            } catch (wsErr) {
                console.error('Error sending WhatsApp:', wsErr.message);
            }
        } else if (!client.info) {
            console.log('WhatsApp client not ready. Message skipped.');
        }

        // Construct the full URL for the local file
        const protocol = req.protocol;
        const host = req.get('host');
        const fileUrl = `${protocol}://${host}/uploads/${finalFileName}`;

        res.json({ message: 'Bill saved and message sent successfully', url: fileUrl });
    } catch (err) {
        console.error('Upload Error:', err);
        res.status(500).send('Error processing bill: ' + err.message);
    }
});

// --- REPORTING ROUTES ---

// 5. Dashboard Summary
app.get('/api/reports/dashboard', async (req, res) => {
    try {
        const stats = { today: { Revenue: 0, Orders: 0 }, pendingDeliveries: 0, topItems: [] };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const billsSnapshot = await db.collection('Bills').get();
        const itemCounts = {};

        billsSnapshot.forEach(doc => {
            const data = doc.data();
            const billDate = data.BillDate.toDate();
            billDate.setHours(0, 0, 0, 0);

            // 1. Today's Revenue & Order Count
            if (billDate.getTime() === today.getTime()) {
                stats.today.Revenue += data.GrandTotal;
                stats.today.Orders += 1;
            }

            // 2. Pending Deliveries
            if (data.ReturnDate) {
                const returnDate = data.ReturnDate.toDate();
                if (returnDate <= new Date() && data.PaymentStatus !== 'Paid') {
                    stats.pendingDeliveries += 1;
                }
            }

            // 3. Collect for Top Items
            if (data.items) {
                data.items.forEach(item => {
                    itemCounts[item.ItemName] = (itemCounts[item.ItemName] || 0) + item.Quantity;
                });
            }
        });

        // Sort and get Top 5
        stats.topItems = Object.keys(itemCounts)
            .map(name => ({ ItemName: name, TotalQty: itemCounts[name] }))
            .sort((a, b) => b.TotalQty - a.TotalQty)
            .slice(0, 5);

        res.json(stats);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching dashboard stats');
    }
});

// 6. Financial Report (Sales History)
app.get('/api/reports/financial', async (req, res) => {
    try {
        const snapshot = await db.collection('Bills')
            .orderBy('BillDate', 'desc')
            .limit(100)
            .get();
        const bills = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                BillID: doc.id,
                ...data,
                BillDate: safeDate(data.BillDate),
                ReturnDate: safeDate(data.ReturnDate)
            };
        });
        res.json(bills);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching financial report');
    }
});

// 7. Operational Report (Pending Deliveries)
app.get('/api/reports/operational', async (req, res) => {
    try {
        const snapshot = await db.collection('Bills').get();

        const bills = snapshot.docs
            .map(doc => {
                const data = doc.data();
                return {
                    BillID: doc.id,
                    ...data,
                    BillDate: safeDate(data.BillDate),
                    ReturnDate: safeDate(data.ReturnDate)
                };
            })
            .filter(bill => bill.PaymentStatus !== 'Paid' && bill.ReturnDate && new Date(bill.ReturnDate) <= new Date())
            .sort((a, b) => new Date(a.ReturnDate) - new Date(b.ReturnDate));

        res.json(bills);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching operational report');
    }
});

// 8. Monthly Sales Report
app.get('/api/reports/monthly-sales', async (req, res) => {
    try {
        const snapshot = await db.collection('Bills').get();
        const monthlyStats = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            const date = data.BillDate.toDate();
            const monthName = date.toLocaleString('default', { month: 'long' });
            const year = date.getFullYear();
            const key = `${monthName}-${year}`;

            if (!monthlyStats[key]) {
                monthlyStats[key] = { MonthName: monthName, Year: year, TotalSales: 0, TotalOrders: 0, MonthNum: date.getMonth() + 1 };
            }
            monthlyStats[key].TotalSales += data.GrandTotal;
            monthlyStats[key].TotalOrders += 1;
        });

        const result = Object.values(monthlyStats).sort((a, b) => {
            if (a.Year !== b.Year) return b.Year - a.Year;
            return b.MonthNum - a.MonthNum;
        });

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching monthly sales');
    }
});

// 9. Overdue Report
app.get('/api/reports/overdue', async (req, res) => {
    try {
        const snapshot = await db.collection('Bills').get();

        const bills = snapshot.docs
            .map(doc => {
                const data = doc.data();
                return {
                    BillID: doc.id,
                    ...data,
                    BillDate: safeDate(data.BillDate),
                    ReturnDate: safeDate(data.ReturnDate)
                };
            })
            .filter(bill => bill.PaymentStatus !== 'Paid' && bill.ReturnDate && new Date(bill.ReturnDate) < new Date())
            .sort((a, b) => new Date(a.ReturnDate) - new Date(b.ReturnDate));

        res.json(bills);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error fetching overdue report');
    }
});

// --- AUTH ROUTES ---

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const usersRef = db.collection('Users');
        const snapshot = await usersRef.where('username', '==', username).get();

        if (snapshot.empty) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const userDoc = snapshot.docs[0];
        const user = userDoc.data();

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        res.json({ message: 'Login successful', username: user.username, userId: userDoc.id });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

// Change Password
app.post('/api/change-password', async (req, res) => {
    try {
        const { username, currentPassword, newPassword } = req.body;
        const usersRef = db.collection('Users');
        const snapshot = await usersRef.where('username', '==', username).get();

        if (snapshot.empty) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userDoc = snapshot.docs[0];
        const user = userDoc.data();

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Incorrect current password' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await usersRef.doc(userDoc.id).update({ password: hashedPassword });

        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ message: 'Server error' });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
