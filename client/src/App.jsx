import { useState, useEffect } from 'react'
import api from './api'
import './App.css'
import InputPanel from './components/InputPanel'
import BillPreview from './components/BillPreview'
import CustomAlert from './components/CustomAlert'
import ShopMaster from './components/ShopMaster'
import ItemMaster from './components/ItemMaster'
import Dashboard from './components/Dashboard'
import Reports from './components/Reports'
import PaymentManager from './components/PaymentManager'
import Login from './components/Login'
import UserSettings from './components/UserSettings'

function App() {
    const [activeTab, setActiveTab] = useState('payments') // Start with Dashboard
    const [shopDetails, setShopDetails] = useState(null)
    const [availableItems, setAvailableItems] = useState([])
    const [billItems, setBillItems] = useState([])
    const [customer, setCustomer] = useState({ name: '', phone: '' })
    const [invoiceNum, setInvoiceNum] = useState('')
    const [editingBill, setEditingBill] = useState(null)
    const [alert, setAlert] = useState({ show: false, message: '' })
    const [user, setUser] = useState(null)

    const fetchData = async () => {
        try {
            const shopRes = await api.get('/shop')
            setShopDetails(shopRes.data)

            const itemsRes = await api.get('/items')
            setAvailableItems(itemsRes.data)

            // Generate Invoice Num
            setInvoiceNum('#FW-' + Math.floor(1000 + Math.random() * 9000))
        } catch (err) {
            console.error("Error fetching data:", err)
        }
    }

    // Fetch Data on Load
    useEffect(() => {
        // Check local storage for auth
        const storedUser = localStorage.getItem('user')
        if (storedUser) {
            setUser(JSON.parse(storedUser))
        }
        // Always fetch data since we bypassed login
        fetchData()
    }, [])

    const refreshData = async () => {
        try {
            const shopRes = await api.get('/shop')
            setShopDetails(shopRes.data)

            const itemsRes = await api.get('/items')
            setAvailableItems(itemsRes.data)
        } catch (err) {
            console.error("Error refreshing data:", err)
        }
    }

    const handleLogin = (userData) => {
        setUser(userData)
        localStorage.setItem('user', JSON.stringify(userData))
        setActiveTab('dashboard')
        fetchData()
    }

    const handleLogout = () => {
        setUser(null)
        localStorage.removeItem('user')
        setActiveTab('dashboard')
    }

    const addItem = (item) => {
        setBillItems([...billItems, { ...item, id: Date.now() }])
    }

    const removeItem = (id) => {
        setBillItems(billItems.filter(item => item.id !== id))
    }

    const resetBill = () => {
        setAlert({
            show: true,
            message: 'Are you sure you want to clear the current bill?',
            isConfirm: true,
            onConfirm: () => {
                setBillItems([])
                setCustomer({ name: '', phone: '' })
                setInvoiceNum('#FW-' + Math.floor(1000 + Math.random() * 9000))
                setEditingBill(null)
            }
        })
    }

    const handleEditBill = (bill) => {
        setEditingBill(bill)
        setCustomer({
            name: bill.CustomerName,
            phone: bill.CustomerPhone,
            town: bill.CustomerTown,
            returnDate: bill.ReturnDate ? new Date(bill.ReturnDate).toISOString().split('T')[0] : ''
        })
        setInvoiceNum(bill.InvoiceNumber)

        // Map items to match internal structure
        const mappedItems = bill.items ? bill.items.map((item, idx) => ({
            id: Date.now() + idx,
            name: item.ItemName || item.name,
            qty: item.Quantity || item.qty,
            price: item.UnitPrice || item.price,
            total: item.TotalPrice || item.total
        })) : [];

        setBillItems(mappedItems)
        setActiveTab('generator')
    }

    const handlePrint = async () => {
        if (billItems.length === 0) return setAlert({ show: true, message: 'Add items first' });

        // Validation
        if (!customer.name) {
            return setAlert({ show: true, message: 'Please enter Customer Name' });
        }

        // Strict 10-digit phone validation
        const phoneRegex = /^\d{10}$/;
        if (!phoneRegex.test(customer.phone)) {
            return setAlert({ show: true, message: 'Contact number must be 10 digit only' });
        }

        if (!customer.returnDate) {
            return setAlert({ show: true, message: 'Please select a Return Date' });
        }

        const subtotal = billItems.reduce((acc, item) => acc + item.total, 0)
        const taxRate = (shopDetails?.TaxRate !== undefined && shopDetails?.TaxRate !== null) ? shopDetails.TaxRate : 0.05
        const tax = subtotal * taxRate
        const grandTotal = subtotal + tax

        try {
            // 1. Save record to DB
            const billRecord = {
                customerName: customer.name,
                customerPhone: customer.phone,
                customerTown: customer.town,
                returnDate: customer.returnDate,
                items: billItems,
                subtotal,
                tax,
                grandTotal,
                invoiceNum,
                billId: editingBill ? editingBill.BillID : null
            };
            await api.post('/bills', billRecord)

            // 2. Generate PDF for Server Saving
            const element = document.querySelector('.bill-paper');
            const opt = {
                margin: 0.5,
                filename: `${customer.name}_${new Date().toLocaleDateString('en-GB').replace(/\//g, '')}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
            };

            // Generate as Base64/Blob to send to server
            const worker = window.html2pdf().from(element).set(opt);
            const pdfBase64 = await worker.outputPdf('datauristring');

            const filename = `${customer.name}_${Date.now()}.pdf`;

            // 3. Upload PDF to Server
            await api.post('/upload-pdf', {
                pdfData: pdfBase64,
                fileName: filename,
                customerName: customer.name,
                customerPhone: customer.phone,
                shopName: shopDetails?.ShopName || 'FreshWash',
                items: billItems,
                billDetails: {
                    invoiceNum,
                    grandTotal,
                    returnDate: customer.returnDate
                },
                isEdited: !!editingBill
            });

            // Clear edit state after saving
            if (editingBill) setEditingBill(null);

            // 4. Open Print Dialog
            window.print()

            // 5. Reset Form
            setCustomer({ name: '', phone: '' })
            setBillItems([])
            setInvoiceNum('#FW-' + Math.floor(1000 + Math.random() * 9000))
            setEditingBill(null)
        } catch (err) {
            setAlert({ show: true, message: 'Error processing bill!' })
            console.error(err)
        }
    }

    return (
        !user ? <Login onLogin={handleLogin} /> :
            <div className="layout-root">
                <div className="background-blobs">
                    <div className="blob blob-1"></div>
                    <div className="blob blob-2"></div>
                    <div className="blob blob-3"></div>
                </div>

                <CustomAlert
                    message={alert.message}
                    isOpen={alert.show}
                    onClose={() => setAlert({ ...alert, show: false })}
                    isConfirm={alert.isConfirm}
                    onConfirm={alert.onConfirm}
                    onCancel={alert.onCancel}
                />

                <nav className="side-nav">
                    <div className="nav-logo">
                        <i className="fa-solid fa-droplet"></i>
                        <span>FW</span>
                    </div>
                    <div className="nav-links">
                        <button
                            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
                            onClick={() => setActiveTab('dashboard')}
                            title="Dashboard"
                        >
                            <i className="fa-solid fa-chart-line"></i>
                        </button>
                        <button
                            className={`nav-btn ${activeTab === 'payments' ? 'active' : ''}`}
                            onClick={() => setActiveTab('payments')}
                            title="Payments"
                        >
                            <i className="fa-solid fa-credit-card"></i>
                        </button>
                        <button
                            className={`nav-btn ${activeTab === 'generator' ? 'active' : ''}`}
                            onClick={() => setActiveTab('generator')}
                            title="Bill Generator"
                        >
                            <i className="fa-solid fa-file-invoice"></i>
                        </button>
                        <button
                            className={`nav-btn ${activeTab === 'reports' ? 'active' : ''}`}
                            onClick={() => setActiveTab('reports')}
                            title="Reports Center"
                        >
                            <i className="fa-solid fa-file-invoice"></i>
                        </button>
                        <button
                            className={`nav-btn ${activeTab === 'shop' ? 'active' : ''}`}
                            onClick={() => setActiveTab('shop')}
                            title="Shop Master"
                        >
                            <i className="fa-solid fa-store"></i>
                        </button>
                        <button
                            className={`nav-btn ${activeTab === 'items' ? 'active' : ''}`}
                            onClick={() => setActiveTab('items')}
                            title="ClothType Master"
                        >
                            <i className="fa-solid fa-shirt"></i>
                        </button>

                        <div className="nav-spacer"></div>

                        <button
                            className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`}
                            onClick={() => setActiveTab('settings')}
                            title="User Settings"
                        >
                            <i className="fa-solid fa-user-gear"></i>
                        </button>
                        <button
                            className="nav-btn logout-btn"
                            onClick={handleLogout}
                            title="Logout"
                        >
                            <i className="fa-solid fa-right-from-bracket"></i>
                        </button>
                    </div>
                </nav>

                <main className="app-main">
                    {activeTab === 'dashboard' && (
                        <div className="master-container">
                            <Dashboard />
                        </div>
                    )}

                    {activeTab === 'payments' && (
                        <div className="master-container">
                            <PaymentManager setAlert={setAlert} onEdit={handleEditBill} />
                        </div>
                    )}

                    {activeTab === 'generator' && (
                        <div className="app-container">
                            <InputPanel
                                availableItems={availableItems}
                                addItem={addItem}
                                customer={customer}
                                setCustomer={setCustomer}
                            />
                            <BillPreview
                                shopDetails={shopDetails}
                                customer={customer}
                                billItems={billItems}
                                removeItem={removeItem}
                                invoiceNum={invoiceNum}
                                onReset={resetBill}
                                onPrint={handlePrint}
                                setAlert={setAlert}
                                isEditing={!!editingBill}
                            />
                        </div>
                    )}

                    {activeTab === 'reports' && (
                        <div className="master-container" style={{ maxWidth: '1200px' }}>
                            <Reports />
                        </div>
                    )}

                    {activeTab === 'shop' && (
                        <div className="master-container">
                            <ShopMaster onUpdate={refreshData} setAlert={setAlert} />
                        </div>
                    )}

                    {activeTab === 'items' && (
                        <div className="master-container">
                            <ItemMaster onRefreshItems={refreshData} setAlert={setAlert} />
                        </div>
                    )}

                    {activeTab === 'settings' && (
                        <div className="master-container">
                            <UserSettings username={user.username} setAlert={setAlert} />
                        </div>
                    )}
                </main>
            </div>
    )
}

export default App
