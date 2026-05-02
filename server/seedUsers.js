const bcrypt = require('bcryptjs');
const { db } = require('./db'); // This initializes Firebase Admin

async function seedUsers() {
    try {
        console.log('Truncating Users collection...');
        const usersRef = db.collection('Users');
        
        // Truncate (delete all documents in the collection)
        const snapshot = await usersRef.get();
        if (!snapshot.empty) {
            const batch = db.batch();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            console.log('Deleted all existing users.');
        }

        const username = 'admin';
        const password = 'admin@123';

        // Hash the password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Add user to database
        await usersRef.add({
            username: username,
            password: hashedPassword,
            createdAt: new Date()
        });

        console.log(`Successfully created user '${username}' with password '${password}'.`);
        process.exit(0);
    } catch (error) {
        console.error('Error seeding user:', error);
        process.exit(1);
    }
}

seedUsers();
